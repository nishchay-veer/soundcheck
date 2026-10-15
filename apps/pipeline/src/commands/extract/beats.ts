import { randomUUID } from "node:crypto";
import { childLogger, logger as rootLogger, type Logger } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import {
  extractVideoBeats,
  extractionRunRow,
  extractionSettings,
  writeRunRecord,
  type ExtractionOutcome,
  type ExtractionSettings,
  type ExtractionTarget,
} from "@soundcheck/core/gemini";
import {
  archiveRaw,
  eligibleVideos,
  progressWriter,
  readChannelRows,
  readStepMarker,
} from "@soundcheck/core/jobs";
import { DATA_API_PAGE_SIZE, parseVideos, videosRequest } from "@soundcheck/core/youtube";
import pLimit from "p-limit";
import { shard, currentTask, type Task } from "../../shard";
import { CATALOGUE_STEP } from "../ingest/catalogue";
import { archiveKey, connectYoutube, type YoutubeApi } from "../ingest/run";
import { loadBeats } from "./load";

/** Gemini requests in flight at once per Cloud Run task. */
export const EXTRACT_CONCURRENCY = 4;

export interface ExtractOptions {
  channelId: string;
  /** One video of the channel's catalogue, eligible or not. */
  video?: string;
  /** At most this many videos (before sharding). */
  limit?: number;
  noCache?: boolean;
  log?: Logger;
  settings?: ExtractionSettings;
  connect?: (channelId: string, log: Logger) => Promise<YoutubeApi>;
  task?: Task;
  /** When the run started; dates the raw archive. */
  now?: Date;
}

export interface ExtractResult {
  runId: string;
  settings: ExtractionSettings;
  outcomes: ExtractionOutcome[];
  /** The videos this task read, with their durations. */
  targets: ExtractionTarget[];
  /** False when sharded: `extract load` then loads once after every task. */
  loaded: boolean;
}

/**
 * `soundcheck extract beats`: Gemini beats for the channel's eligible videos
 * (or one `--video`), four at a time, sharded across Cloud Run tasks. Cached
 * extractions cost nothing. Each video's outcome is written as a run record;
 * a single-task run then loads the channel's beat tables.
 */
export async function extractBeats(options: ExtractOptions): Promise<ExtractResult> {
  const { channelId } = options;
  const runId = randomUUID().replaceAll("-", "");
  const log = childLogger(
    { channel_id: channelId, stage: "extract", run_id: runId },
    options.log ?? rootLogger,
  );
  const settings = options.settings ?? extractionSettings();
  const task = options.task ?? currentTask();
  await loadChannel(channelId);

  let ids: string[];
  if (options.video) {
    const catalogue = await readChannelRows("videos", ["video_id"], channelId);
    if (!catalogue.some((row) => row.video_id === options.video)) {
      throw new Error(
        `Video ${options.video} is not in ${channelId}'s catalogue: run "ingest catalogue" first`,
      );
    }
    ids = [options.video];
  } else {
    if (!(await readStepMarker(channelId, CATALOGUE_STEP))) {
      throw new Error(`No catalogue for ${channelId}: run "ingest catalogue" first`);
    }
    ids = (await eligibleVideos(channelId)).map((video) => video.id);
  }
  ids = shard(ids.slice(0, options.limit ?? ids.length), task);

  // Current duration and privacy, from the Data API; raw responses archived first.
  const api = await (options.connect ?? connectYoutube)(channelId, log);
  const targets: ExtractionTarget[] = [];
  for (let start = 0, batch = 0; start < ids.length; start += DATA_API_PAGE_SIZE, batch += 1) {
    const batchIds = ids.slice(start, start + DATA_API_PAGE_SIZE);
    const request = videosRequest(batchIds);
    const body = await api.videos(request);
    await archiveRaw({
      channelId,
      source: "youtube-videos",
      key: `extract-${archiveKey("batch", batch)}`,
      body,
      request,
      fetchedAt: options.now ?? new Date(),
    });
    const found = parseVideos(body).filter((video) => batchIds.includes(video.id));
    const missing = batchIds.filter((id) => !found.some((video) => video.id === id));
    if (missing.length > 0)
      log.warn({ missing }, "videos not returned by YouTube (deleted?); skipped");
    for (const video of found) {
      if (video.durationS > 0) {
        targets.push({
          channelId,
          videoId: video.id,
          durationS: video.durationS,
          privacyStatus: video.privacyStatus,
        });
      } else {
        log.warn(
          { video_id: video.id },
          "video has no duration yet (an upcoming stream?); skipped",
        );
      }
    }
  }

  const progress = progressWriter(channelId, "extract", { log });
  progress.update(0, targets.length);
  const limit = pLimit(EXTRACT_CONCURRENCY);
  let done = 0;
  const outcomes = await Promise.all(
    targets.map((target) =>
      limit(async () => {
        const outcome = await extractVideoBeats(target, {
          settings,
          noCache: options.noCache,
          log,
        });
        await writeRunRecord(extractionRunRow(outcome, { runId, channelId, settings }));
        progress.update((done += 1), targets.length);
        return outcome;
      }),
    ),
  );
  await progress.flush();

  const summary = summarize(outcomes, targets);
  log.info(
    { ...summary, model: settings.model, video_mode: settings.videoMode },
    "beats extracted",
  );
  const loaded = task.count === 1;
  if (loaded) await loadBeats(channelId, { settings, log });
  return { runId, settings, outcomes, targets, loaded };
}

export interface ExtractSummary {
  videos: number;
  statuses: Record<string, number>;
  prompt_tokens: number;
  output_tokens: number;
  cost_usd: number | null;
  /** Of the videos Gemini read in this run. */
  cost_per_minute_usd: number | null;
  tokens_per_video: number | null;
}

/** Totals for the log line and the printed table. */
export function summarize(
  outcomes: readonly ExtractionOutcome[],
  targets: readonly ExtractionTarget[],
): ExtractSummary {
  const statuses: Record<string, number> = {};
  for (const outcome of outcomes) statuses[outcome.status] = (statuses[outcome.status] ?? 0) + 1;
  const read = outcomes.filter((outcome) => outcome.usage.calls > 0);
  const tokens = (outcome: ExtractionOutcome) =>
    outcome.usage.prompt_tokens +
    outcome.usage.tool_use_tokens +
    outcome.usage.output_tokens +
    outcome.usage.thinking_tokens;
  const costs = outcomes.map((outcome) => outcome.usage.cost_usd);
  const cost = costs.some((c) => c === null)
    ? null
    : costs.reduce<number>((sum, c) => sum + (c ?? 0), 0);
  const minutesRead =
    read.reduce(
      (sum, outcome) => sum + (targets.find((t) => t.videoId === outcome.videoId)?.durationS ?? 0),
      0,
    ) / 60;
  const readCost = read.every((outcome) => outcome.usage.cost_usd !== null)
    ? read.reduce((sum, outcome) => sum + (outcome.usage.cost_usd ?? 0), 0)
    : null;
  return {
    videos: outcomes.length,
    statuses,
    prompt_tokens: outcomes.reduce(
      (sum, o) => sum + o.usage.prompt_tokens + o.usage.tool_use_tokens,
      0,
    ),
    output_tokens: outcomes.reduce(
      (sum, o) => sum + o.usage.output_tokens + o.usage.thinking_tokens,
      0,
    ),
    cost_usd: cost,
    cost_per_minute_usd: readCost !== null && minutesRead > 0 ? readCost / minutesRead : null,
    tokens_per_video:
      read.length > 0 ? read.reduce((sum, o) => sum + tokens(o), 0) / read.length : null,
  };
}

const money = (value: number | null) => (value === null ? "n/a" : `$${value.toFixed(4)}`);

/** The table `extract beats` prints. */
export function formatExtraction(result: ExtractResult): string {
  const { settings, outcomes, targets } = result;
  const summary = summarize(outcomes, targets);
  const rows = outcomes.map((outcome) => {
    const usage = outcome.usage;
    return [
      outcome.videoId.padEnd(12),
      outcome.status.padEnd(20),
      String(outcome.extraction?.beats.beats.length ?? "-").padStart(5),
      (outcome.extraction ? `${Math.round(outcome.extraction.coverage * 100)}%` : "-").padStart(9),
      String(usage.prompt_tokens + usage.tool_use_tokens).padStart(10),
      String(usage.output_tokens + usage.thinking_tokens).padStart(11),
      money(usage.cost_usd).padStart(9),
      `${Math.round(usage.latency_ms / 1000)} s`.padStart(7),
    ].join(" ");
  });
  return [
    `Beat extraction, run ${result.runId} (${settings.model}, ${settings.videoMode})`,
    `  ${"video".padEnd(12)} ${"status".padEnd(20)} beats  coverage  tokens in  tokens out      cost    time`,
    ...rows.map((row) => `  ${row}`),
    `  ${summary.videos} videos: ${Object.entries(summary.statuses)
      .map(([status, n]) => `${n} ${status}`)
      .join(", ")}; ` +
      `${summary.prompt_tokens} tokens in, ${summary.output_tokens} out; cost ${money(summary.cost_usd)}; ` +
      `${money(summary.cost_per_minute_usd)} per minute of video read`,
    ...(result.loaded
      ? []
      : ["  Sharded run: rows are not loaded; run `extract load` after every task finishes."]),
  ].join("\n");
}
