import { readChannelRows, readStepMarker, replaceChannelRows } from "@soundcheck/core/jobs";
import type {
  Audience,
  CoverageStatus,
  RetentionCoverageRow,
  RetentionCurveRow,
} from "@soundcheck/core/schemas";
import {
  AUDIENCES,
  SEGMENT_METRICS,
  curveRows,
  pacificDate,
  parseRetentionPoints,
  parseSegmentCounts,
  retentionQuery,
  skippedCoverageRow,
  type CurveContext,
  type SegmentOutcome,
} from "@soundcheck/core/youtube";
import pLimit from "p-limit";
import { catalogueVideos } from "./catalogue";
import { MIX_STEP } from "./mix";
import type { IngestOptions, IngestRun } from "./run";
import { coveredVideos, startIngest } from "./run";
import { STATS_STEP } from "./stats";

export const RETENTION_STEP = "ingest-retention";
/** The report takes one video per call, so calls run five at a time. */
export const RETENTION_CONCURRENCY = 5;
/** `organic` is measured only when ads bring more than this share of a video's views. */
export const ORGANIC_AD_SHARE = 0.02;
/** A channel is usable for modeling with this many videos that have complete subscribed and unsubscribed curves. */
export const USABLE_VIDEOS = 40;
/** Segment counts are optional: two attempts, so a persistent error cannot stall the run. */
const SEGMENT_ATTEMPTS = 2;

export interface CoverageSummary {
  channelId: string;
  asOf: string;
  eligibleVideos: number;
  /** Videos with complete subscribed and unsubscribed curves. */
  completeVideos: number;
  medianViews: number | null;
  analyticsQueries: number;
  usable: boolean;
  byAudience: Record<Audience, Record<CoverageStatus, number>>;
  segmentCounts: Record<SegmentOutcome["status"], number>;
}

/** The median of a list, or null when it is empty. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/** The coverage table `ingest retention` prints. */
export function formatCoverage(summary: CoverageSummary): string {
  const line = (label: string, value: string | number) => `  ${label.padEnd(48)} ${value}`;
  const statuses: CoverageStatus[] = ["complete", "partial", "insufficient_data", "skipped"];
  const curves = Object.values(summary.segmentCounts).reduce((sum, n) => sum + n, 0);
  return [
    `Retention coverage for ${summary.channelId} (data through ${summary.asOf})`,
    line("Eligible videos", summary.eligibleVideos),
    line("Complete subscribed and unsubscribed curves", summary.completeVideos),
    line("Median views per eligible video", summary.medianViews ?? "n/a"),
    line("Analytics calls", summary.analyticsQueries),
    line(
      `Usable for modeling (${USABLE_VIDEOS}+ complete videos)`,
      summary.usable ? "yes" : `no (${summary.completeVideos} of ${USABLE_VIDEOS})`,
    ),
    "",
    `  ${"Audience".padEnd(14)}${statuses.map((status) => status.padStart(19)).join("")}`,
    ...AUDIENCES.map(
      (audience) =>
        `  ${audience.padEnd(14)}${statuses
          .map((status) => String(summary.byAudience[audience][status]).padStart(19))
          .join("")}`,
    ),
    "",
    `  Segment counts (startedWatching, stoppedWatching) for ${curves} curves: ${summary.segmentCounts.available} available, ${summary.segmentCounts.empty} empty, ${summary.segmentCounts.error} errors, ${summary.segmentCounts.not_requested} not requested`,
  ].join("\n");
}

/** Refuses to run before an earlier step this one reads from. */
async function requireStep(run: IngestRun, step: string, command: string): Promise<void> {
  if (!(await readStepMarker(run.channel.id, step))) {
    throw new Error(`No ${step} data for ${run.channel.id}: run "ingest ${command}" first`);
  }
}

/** Total views and views from ads per video, from `video_stats` and `video_traffic_mix`. */
async function viewsByVideo(channelId: string) {
  const views = new Map<string, number>();
  for (const row of await readChannelRows("video_stats", ["video_id", "views"], channelId)) {
    const id = String(row.video_id);
    views.set(id, (views.get(id) ?? 0) + Number(row.views ?? 0));
  }
  const adViews = new Map<string, number>();
  for (const row of await readChannelRows(
    "video_traffic_mix",
    ["video_id", "raw_type", "views"],
    channelId,
  )) {
    if (row.raw_type !== "ADVERTISING") continue;
    const id = String(row.video_id);
    adViews.set(id, (adViews.get(id) ?? 0) + Number(row.views ?? 0));
  }
  return { views, adViews };
}

/** The API's own message for a failed call. */
function errorMessage(error: unknown): string {
  const { response, message } = error as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const status = response?.status ? `HTTP ${response.status}: ` : "";
  return `${status}${response?.data?.error?.message ?? message ?? String(error)}`;
}

/** Fetches one curve, then its segment counts if the curve has data. */
async function fetchCurve(run: IngestRun, context: CurveContext, publishedAt: string) {
  const request = {
    videoId: context.videoId,
    audience: context.audience,
    startDate: pacificDate(new Date(publishedAt)),
    endDate: run.asOf,
  };
  const key = `${context.videoId}-${context.audience}`;
  const points = parseRetentionPoints(
    await run.report("analytics-retention", key, retentionQuery(request)),
  );

  let segments: SegmentOutcome = { status: "not_requested" };
  if (points.length > 0) {
    try {
      const body = await run.report(
        "analytics-retention-segments",
        key,
        retentionQuery(request, SEGMENT_METRICS),
        { maxAttempts: SEGMENT_ATTEMPTS },
      );
      const counts = parseSegmentCounts(body);
      segments = counts.size > 0 ? { status: "available", counts } : { status: "empty" };
    } catch (error) {
      segments = { status: "error", message: errorMessage(error) };
    }
  }
  return { ...curveRows(context, points, segments), segments: segments.status };
}

/**
 * `soundcheck ingest retention`: the measured retention curve for every
 * eligible video and audience (all, subscribed, unsubscribed, and organic when
 * ads bring more than 2% of views), with monotone survival and hazards, plus a
 * coverage row per video and audience. Replaces the channel's
 * `retention_curves` and `retention_coverage` rows.
 */
export async function ingestRetention(
  options: IngestOptions,
): Promise<
  | { curves: RetentionCurveRow[]; coverage: RetentionCoverageRow[]; summary: CoverageSummary }
  | undefined
> {
  const run = await startIngest(RETENTION_STEP, options);
  if (!run) return undefined;
  const channelId = run.channel.id;

  const videos = coveredVideos(await catalogueVideos(run), options.publishedSince);
  await requireStep(run, STATS_STEP, "stats");
  await requireStep(run, MIX_STEP, "mix");
  const { views, adViews } = await viewsByVideo(channelId);

  const coverage: RetentionCoverageRow[] = [];
  const tasks: Array<{ context: CurveContext; publishedAt: string }> = [];
  for (const video of videos) {
    for (const audience of AUDIENCES) {
      const context = { channelId, videoId: video.id, audience, asOf: run.asOf };
      if (audience === "organic") {
        const total = views.get(video.id) ?? 0;
        const share = total > 0 ? (adViews.get(video.id) ?? 0) / total : 0;
        if (share <= ORGANIC_AD_SHARE) {
          const percent = (share * 100).toFixed(1);
          coverage.push(skippedCoverageRow(context, `ad views ${percent}% of views, not above 2%`));
          continue;
        }
      }
      tasks.push({ context, publishedAt: video.publishedAt });
    }
  }

  const limit = pLimit(RETENTION_CONCURRENCY);
  let done = 0;
  const results = await Promise.all(
    tasks.map(({ context, publishedAt }) =>
      limit(async () => {
        try {
          const result = await fetchCurve(run, context, publishedAt);
          run.progress.update((done += 1), tasks.length);
          return result;
        } catch (error) {
          // A curve that cannot be fetched fails the step; stop queued calls.
          limit.clearQueue();
          throw error;
        }
      }),
    ),
  );

  const curves = results.flatMap((result) => result.curve);
  coverage.push(...results.map((result) => result.coverage));
  const load = {
    channelId,
    runId: run.runId,
    log: run.log,
    ...(options.publishedSince ? { videoIds: videos.map((video) => video.id) } : {}),
  };
  await replaceChannelRows({ ...load, table: "retention_curves", rows: curves });
  await replaceChannelRows({ ...load, table: "retention_coverage", rows: coverage });

  const summary = summarize(run, videos.length, coverage, results, views);
  await run.finish(
    { retention_curves: curves.length, retention_coverage: coverage.length },
    {
      eligible_videos: summary.eligibleVideos,
      complete_videos: summary.completeVideos,
      median_views: summary.medianViews,
      usable: summary.usable,
      coverage: summary.byAudience,
      segment_counts: summary.segmentCounts,
    },
  );
  return { curves, coverage, summary };
}

function summarize(
  run: IngestRun,
  eligibleVideos: number,
  coverage: readonly RetentionCoverageRow[],
  results: ReadonlyArray<{ segments: SegmentOutcome["status"] }>,
  views: ReadonlyMap<string, number>,
): CoverageSummary {
  const statuses = (): Record<CoverageStatus, number> => ({
    complete: 0,
    partial: 0,
    insufficient_data: 0,
    skipped: 0,
  });
  const byAudience = Object.fromEntries(
    AUDIENCES.map((audience) => [audience, statuses()]),
  ) as Record<Audience, Record<CoverageStatus, number>>;
  for (const row of coverage) byAudience[row.audience][row.status] += 1;

  const complete = (audience: Audience) =>
    new Set(
      coverage
        .filter((row) => row.audience === audience && row.status === "complete")
        .map((row) => row.video_id),
    );
  const subscribed = complete("subscribed");
  const completeVideos = [...complete("unsubscribed")].filter((id) => subscribed.has(id)).length;

  const segmentCounts: Record<SegmentOutcome["status"], number> = {
    available: 0,
    empty: 0,
    error: 0,
    not_requested: 0,
  };
  for (const result of results) segmentCounts[result.segments] += 1;

  const eligibleIds = new Set(coverage.map((row) => row.video_id));
  return {
    channelId: run.channel.id,
    asOf: run.asOf,
    eligibleVideos,
    completeVideos,
    medianViews: median([...eligibleIds].map((id) => views.get(id) ?? 0)),
    analyticsQueries: run.calls.analyticsQueries,
    usable: completeVideos >= USABLE_VIDEOS,
    byAudience,
    segmentCounts,
  };
}
