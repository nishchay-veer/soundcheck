import {
  audienceSchema,
  retentionCoverageRowSchema,
  retentionCurveRowSchema,
  type Audience,
  type RetentionCoverageRow,
  type RetentionCurveRow,
} from "../schemas";
import { survivalLabels } from "../stats/survival";
import { reportRows, type AnalyticsQuery } from "./analytics";

/**
 * The audience retention report: one curve per video and audience, 100 points
 * at elapsed ratios 0.01 to 1.00. It takes exactly one video per call, and
 * returns no rows when the video has too few views in the date range.
 */

export const RETENTION_POINTS = 100;

/** Each audience's extra filter. `organic` is only worth asking for when ads bring views. */
export const AUDIENCE_SLICES: Record<Audience, string> = {
  all: "",
  subscribed: "subscribedStatus==SUBSCRIBED",
  unsubscribed: "subscribedStatus==UNSUBSCRIBED",
  organic: "audienceType==ORGANIC",
};
export const AUDIENCES: readonly Audience[] = audienceSchema.options;

/**
 * The curve. Probed in Phase 04: adding `startedWatching` or `stoppedWatching`
 * to these makes the report return no rows, so they are asked for separately.
 */
export const RETENTION_METRICS =
  "audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions";
/**
 * Segment counts. On the Phase 04 test channel the API answered HTTP 500 for
 * each alone and no rows for both together, for every video; they are stored
 * whenever YouTube returns them.
 */
export const SEGMENT_METRICS = "startedWatching,stoppedWatching";

export interface CurveRequest {
  videoId: string;
  audience: Audience;
  /** The video's publish date, Pacific time. */
  startDate: string;
  endDate: string;
}

export function retentionQuery(
  { videoId, audience, startDate, endDate }: CurveRequest,
  metrics: string = RETENTION_METRICS,
): AnalyticsQuery {
  const slice = AUDIENCE_SLICES[audience];
  return {
    startDate,
    endDate,
    dimensions: "elapsedVideoTimeRatio",
    metrics,
    filters: slice ? `video==${videoId};${slice}` : `video==${videoId}`,
  };
}

/** Bin 1..100 for an elapsed ratio of 0.01..1.00. */
function binOf(elapsedRatio: unknown): number {
  const bin = Math.round(Number(elapsedRatio) * RETENTION_POINTS);
  if (!Number.isInteger(bin) || bin < 1 || bin > RETENTION_POINTS) {
    throw new RangeError(`elapsedVideoTimeRatio out of range: ${String(elapsedRatio)}`);
  }
  return bin;
}

/** Rows keyed by bin, refusing a bin reported twice. */
function rowsByBin(body: unknown): Map<number, Record<string, unknown>> {
  const bins = new Map<number, Record<string, unknown>>();
  for (const row of reportRows(body)) {
    const bin = binOf(row.elapsedVideoTimeRatio);
    if (bins.has(bin)) throw new Error(`Retention report returned bin ${bin} twice`);
    bins.set(bin, row);
  }
  return bins;
}

const numberOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

export interface RetentionPoint {
  bin: number;
  elapsedRatio: number;
  audienceWatchRatio: number;
  relativeRetention: number | null;
  totalSegmentImpressions: number | null;
}

/** Pure parser for a curve response: its points in bin order. No rows gives `[]`. */
export function parseRetentionPoints(body: unknown): RetentionPoint[] {
  return [...rowsByBin(body)]
    .sort(([a], [b]) => a - b)
    .map(([bin, row]) => ({
      bin,
      elapsedRatio: bin / RETENTION_POINTS,
      audienceWatchRatio: Number(row.audienceWatchRatio),
      relativeRetention: numberOrNull(row.relativeRetentionPerformance),
      totalSegmentImpressions: numberOrNull(row.totalSegmentImpressions),
    }));
}

export interface SegmentCounts {
  startedWatching: number | null;
  stoppedWatching: number | null;
}

/** Pure parser for a segment-count response, keyed by bin. */
export function parseSegmentCounts(body: unknown): Map<number, SegmentCounts> {
  return new Map(
    [...rowsByBin(body)].map(([bin, row]) => [
      bin,
      {
        startedWatching: numberOrNull(row.startedWatching),
        stoppedWatching: numberOrNull(row.stoppedWatching),
      },
    ]),
  );
}

/** What happened to the segment-count call for one curve. */
export type SegmentOutcome =
  | { status: "available"; counts: Map<number, SegmentCounts> }
  | { status: "empty" }
  | { status: "error"; message: string }
  /** Not asked: the curve itself had no data. */
  | { status: "not_requested" };

export interface CurveContext {
  channelId: string;
  videoId: string;
  audience: Audience;
  asOf: string;
}

/**
 * One measured curve as BigQuery rows: a `retention_curves` row per point that
 * arrived (with `s_mono` and hazard derived from them) and its
 * `retention_coverage` row. Missing points are never filled in.
 */
export function curveRows(
  context: CurveContext,
  points: readonly RetentionPoint[],
  segments: SegmentOutcome,
): { curve: RetentionCurveRow[]; coverage: RetentionCoverageRow } {
  const { channelId, videoId, audience, asOf } = context;
  const details = {
    segment_counts: segments.status,
    ...(segments.status === "error" ? { segment_error: segments.message } : {}),
  };
  if (points.length === 0) {
    return {
      curve: [],
      coverage: retentionCoverageRowSchema.parse({
        channel_id: channelId,
        video_id: videoId,
        audience,
        status: "insufficient_data",
        points: 0,
        rewatch_bumps: null,
        rewatch_mass: null,
        as_of: asOf,
        details,
      }),
    };
  }

  const labels = survivalLabels(points.map((point) => point.audienceWatchRatio));
  const counts =
    segments.status === "available" ? segments.counts : new Map<number, SegmentCounts>();
  const curve = points.map((point, index) =>
    retentionCurveRowSchema.parse({
      channel_id: channelId,
      video_id: videoId,
      audience,
      bin: point.bin,
      elapsed_ratio: point.elapsedRatio,
      audience_watch_ratio: point.audienceWatchRatio,
      relative_retention: point.relativeRetention,
      started_watching: counts.get(point.bin)?.startedWatching ?? null,
      stopped_watching: counts.get(point.bin)?.stoppedWatching ?? null,
      total_segment_impressions: point.totalSegmentImpressions,
      s_mono: labels.sMono[index],
      hazard: labels.hazard[index],
      as_of: asOf,
    }),
  );
  return {
    curve,
    coverage: retentionCoverageRowSchema.parse({
      channel_id: channelId,
      video_id: videoId,
      audience,
      status: points.length === RETENTION_POINTS ? "complete" : "partial",
      points: points.length,
      rewatch_bumps: labels.rewatchBumps,
      rewatch_mass: labels.rewatchMass,
      as_of: asOf,
      details,
    }),
  };
}

/** The coverage row for an audience that was not requested. */
export function skippedCoverageRow(context: CurveContext, reason: string): RetentionCoverageRow {
  return retentionCoverageRowSchema.parse({
    channel_id: context.channelId,
    video_id: context.videoId,
    audience: context.audience,
    status: "skipped",
    points: 0,
    rewatch_bumps: null,
    rewatch_mass: null,
    as_of: context.asOf,
    details: { reason },
  });
}
