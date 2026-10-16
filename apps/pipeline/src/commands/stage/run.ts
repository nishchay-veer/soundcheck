import { childLogger, getJobEnv, logger as rootLogger, type Logger } from "@soundcheck/core";
import { progressWriter, readChannelRows, recordBuildCounts } from "@soundcheck/core/jobs";
import { runBaselineLlm } from "../baseline-llm/run";
import { extractBeats } from "../extract/beats";
import { loadBeats } from "../extract/load";
import { buildFeatures } from "../features/run";
import { ingestCatalogue } from "../ingest/catalogue";
import { ingestMix } from "../ingest/mix";
import { ingestRetention } from "../ingest/retention";
import { ingestStats } from "../ingest/stats";
import { formatPublish } from "../publish";
import { publishChannel } from "../publish/run";

/**
 * The TypeScript stages of the `channel_build` workflow (Phase 10), one per
 * Cloud Run job execution. The Python stages (train, evaluate) are in
 * `soundcheck-modeling stage`. Every stage is safe to re-run: each step skips
 * work it already finished (rule 7).
 */
export const STAGES = [
  "ingest",
  "extract",
  "extract-load",
  "features",
  "baseline",
  "publish",
] as const;
export type Stage = (typeof STAGES)[number];
export type BuildMode = "build" | "refresh";

/** A refresh re-fetches stats and retention for videos published this recently. */
export const REFRESH_DAYS = 60;

/** The functions a stage runs; tests replace them. */
export const STEPS = {
  ingestCatalogue,
  ingestStats,
  ingestMix,
  ingestRetention,
  extractBeats,
  loadBeats,
  buildFeatures,
  runBaselineLlm,
  recordBuildCounts,
  publishChannel,
};

export interface StageOptions {
  /** Defaults to the job's CHANNEL_ID. */
  channelId?: string;
  /** Defaults to the job's BUILD_MODE. */
  mode?: BuildMode;
  now?: Date;
  log?: Logger;
  steps?: typeof STEPS;
}

/** The channel and mode from the options, or from the job environment. */
export function stageTarget(options: Pick<StageOptions, "channelId" | "mode">) {
  const env = getJobEnv();
  const channelId = options.channelId ?? env.CHANNEL_ID;
  if (!channelId) throw new Error("No channel: pass --channel or set CHANNEL_ID");
  return { channelId, mode: options.mode ?? env.BUILD_MODE, runId: env.RUN_ID };
}

/** The day `days` before `now`, `YYYY-MM-DD`. */
const daysBefore = (now: Date, days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);

/**
 * Eligible videos, and those with a complete retention curve for at least one
 * training audience: the workflow stops with `insufficient_data` only when
 * there is no usable one. Fewer than MIN_TRAIN_VIDEOS still build, and their
 * models are marked not usable.
 */
export async function countVideos(channelId: string) {
  const eligible = new Set(
    (await readChannelRows("videos", ["video_id", "eligible"], channelId))
      .filter((row) => row.eligible === true)
      .map((row) => String(row.video_id)),
  );
  const usable = new Set(
    (await readChannelRows("retention_coverage", ["video_id", "audience", "status"], channelId))
      .filter(
        (row) =>
          row.status === "complete" &&
          row.audience !== "organic" &&
          eligible.has(String(row.video_id)),
      )
      .map((row) => String(row.video_id)),
  );
  return { eligibleVideos: eligible.size, usableVideos: usable.size };
}

/**
 * Runs `work` with a progress writer for the stage, so the build screen can
 * count it, and writes the last value even when the work fails.
 */
async function reporting<T>(
  channelId: string,
  stage: Stage,
  log: Logger,
  work: (progress: (done: number, total: number) => void) => Promise<T>,
): Promise<T> {
  const writer = progressWriter(channelId, stage, { log });
  try {
    return await work((done, total) => writer.update(done, total));
  } finally {
    await writer.flush();
  }
}

/** Runs one stage and returns a line for the job's output. */
export async function runStage(stage: Stage, options: StageOptions = {}): Promise<string> {
  const { channelId, mode, runId } = stageTarget(options);
  const { now = new Date(), steps = STEPS } = options;
  // The build's stage and run go under their own keys: each command binds its
  // own `stage` and `run_id`, and a key bound twice with different values
  // comes out garbled in Cloud Logging (see childLogger).
  const log = childLogger(
    { channel_id: channelId, build_stage: stage, ...(runId ? { build_run_id: runId } : {}) },
    options.log ?? rootLogger,
  );
  const ingest = { channelId, now, log };

  switch (stage) {
    case "ingest": {
      // A refresh also re-reads the catalogue, so new videos get their beats.
      await steps.ingestCatalogue(ingest);
      const publishedSince = mode === "refresh" ? daysBefore(now, REFRESH_DAYS) : undefined;
      await steps.ingestStats({ ...ingest, publishedSince });
      if (mode === "build") await steps.ingestMix(ingest);
      await steps.ingestRetention({ ...ingest, publishedSince });
      const counts = await countVideos(channelId);
      await steps.recordBuildCounts(channelId, counts);
      return `ingest (${mode}): ${counts.eligibleVideos} eligible videos, ${counts.usableVideos} usable`;
    }
    case "extract": {
      const result = await steps.extractBeats({ channelId, log });
      const statuses = new Map<string, number>();
      for (const { status } of result.outcomes)
        statuses.set(status, (statuses.get(status) ?? 0) + 1);
      const summary =
        [...statuses].map(([status, n]) => `${n} ${status}`).join(", ") || "nothing to do";
      return `extract: ${summary}`;
    }
    case "extract-load": {
      const loaded = await reporting(channelId, stage, log, (progress) =>
        steps.loadBeats(channelId, { log, progress }),
      );
      return `extract-load: ${loaded.videos} videos, ${loaded.beats} beats`;
    }
    case "features": {
      const result = await steps.buildFeatures({ channelId, log, now });
      return `features: ${result.rows} rows from ${result.used.length} videos${result.written ? "" : " (unchanged)"}`;
    }
    case "baseline": {
      const run = await reporting(channelId, stage, log, (progress) =>
        steps.runBaselineLlm({ channelId, log, progress }),
      );
      return `baseline: ${run.outcomes.length} videos (${run.mode}), ${run.rows} curves`;
    }
    case "publish":
      return formatPublish(
        await reporting(channelId, stage, log, (progress) =>
          steps.publishChannel({ channelId, now, log, progress, ...(runId ? { runId } : {}) }),
        ),
      );
  }
}
