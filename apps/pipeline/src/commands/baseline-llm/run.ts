import { randomUUID } from "node:crypto";
import {
  FEATURE_VERSION,
  childLogger,
  logger as rootLogger,
  pickServerEnv,
  type Logger,
} from "@soundcheck/core";
import {
  extractionSettings,
  predictBaselineCurve,
  readBaselineCurves,
  type BaselineOutcome,
  type ExtractionSettings,
} from "@soundcheck/core/gemini";
import { readChannelRows, replaceChannelRows } from "@soundcheck/core/jobs";
import { evaluationTestVideos } from "@soundcheck/core/model";
import { BASELINE_PROMPT_VERSION } from "@soundcheck/core/prompts";
import pLimit from "p-limit";

/** Two Gemini calls at a time, as in the Phase 06 consistency runs. */
const CONCURRENCY = 2;

export interface BaselineRun {
  channelId: string;
  mode: "holdout" | "check" | "chosen";
  outcomes: BaselineOutcome[];
  /** Rows now in `baseline_llm_curves` for the channel. */
  rows: number;
  costUsd: number | null;
}

/** DATE and TIMESTAMP values arrive from the client as `{ value }` objects. */
const plain = (value: unknown): string =>
  String(
    value !== null && typeof value === "object" && "value" in value
      ? (value as { value: unknown }).value
      : value,
  );

/**
 * `soundcheck baseline-llm`: the generic-LLM baseline (Phase 09, B1) for the
 * videos the evaluation will hold out (or one chosen video). Gemini sees each
 * video and its length and guesses the retention curve of a typical YouTube
 * audience, with no channel data. Curves are cached, so a re-run costs
 * nothing; `baseline_llm_curves` is then rebuilt from every cached curve.
 */
export async function runBaselineLlm({
  channelId,
  video,
  noCache = false,
  settings = extractionSettings(),
  log = rootLogger,
  progress,
}: {
  channelId: string;
  video?: string;
  noCache?: boolean;
  settings?: ExtractionSettings;
  log?: Logger;
  /** Told how many videos have their curve. */
  progress?: (done: number, total: number) => void;
}): Promise<BaselineRun> {
  const runId = randomUUID().replaceAll("-", "");
  const runLog = childLogger({ channel_id: channelId, stage: "baseline-llm", run_id: runId }, log);
  const context = (
    await readChannelRows("feature_contexts", ["feature_version", "video_ids", "as_of"], channelId)
  ).find((row) => row.feature_version === FEATURE_VERSION);
  if (!context) {
    throw new Error(
      `No ${FEATURE_VERSION} features for ${channelId}: run "soundcheck features" first`,
    );
  }
  const usable = new Set((context.video_ids as unknown[]).map(String));
  const videos = new Map(
    (await readChannelRows("videos", ["video_id", "published_at", "duration_s"], channelId)).map(
      (row) => [
        String(row.video_id),
        { published: plain(row.published_at).slice(0, 10), durationS: Number(row.duration_s) },
      ],
    ),
  );

  let mode: BaselineRun["mode"] = "chosen";
  let targets: string[];
  if (video) {
    if (!videos.has(video)) throw new Error(`${video} is not a video of ${channelId}`);
    targets = [video];
  } else {
    const split = evaluationTestVideos(
      [...usable].flatMap((id) => {
        const info = videos.get(id);
        return info ? [{ videoId: id, published: info.published }] : [];
      }),
      plain(context.as_of),
      pickServerEnv(["MIN_TRAIN_VIDEOS"]).MIN_TRAIN_VIDEOS,
    );
    mode = split.mode;
    targets = split.test;
  }

  const limit = pLimit(CONCURRENCY);
  let done = 0;
  progress?.(0, targets.length);
  const outcomes = await Promise.all(
    targets.map((videoId) =>
      limit(async () => {
        const outcome = await predictBaselineCurve(
          { channelId, videoId, durationS: videos.get(videoId)?.durationS ?? 0 },
          { settings, noCache, log: runLog },
        );
        progress?.((done += 1), targets.length);
        return outcome;
      }),
    ),
  );

  const rows = await readBaselineCurves(channelId);
  await replaceChannelRows({ table: "baseline_llm_curves", channelId, rows, runId, log: runLog });
  const predicted = outcomes.filter((o) => o.status === "predicted");
  const costs = predicted.map((o) => o.row?.cost_usd ?? null);
  const costUsd = costs.includes(null)
    ? null
    : costs.reduce<number>((sum, cost) => sum + (cost ?? 0), 0);
  runLog.info(
    {
      prompt_version: BASELINE_PROMPT_VERSION,
      videos: targets.length,
      predicted: predicted.length,
    },
    "baseline curves done",
  );
  return { channelId, mode, outcomes, rows: rows.length, costUsd };
}

/** A short report for the terminal. */
export function formatBaselineRun(run: BaselineRun): string {
  const label = {
    holdout: "the held-out test videos",
    check: "every video (check mode: too few videos to hold some out)",
    chosen: "the chosen video",
  }[run.mode];
  return [
    `Generic-LLM baseline (${BASELINE_PROMPT_VERSION}) for ${run.channelId}: ${label}`,
    ...run.outcomes.map((o) => {
      const detail =
        o.status === "predicted" || o.status === "cached"
          ? `ends at ${((o.row?.curve.at(-1) ?? 0) * 100).toFixed(0)}% still watching${o.row?.repaired ? " (made non-increasing)" : ""}`
          : o.errors.join("; ");
      return `  ${o.videoId}: ${o.status}, ${detail}`;
    }),
    `  baseline_llm_curves: ${run.rows} rows; cost of new calls ${run.costUsd === null ? "unknown" : `$${run.costUsd.toFixed(4)}`}`,
  ].join("\n");
}
