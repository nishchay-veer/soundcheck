import {
  subscribedStatusSchema,
  videoStatsRowSchema,
  type SubscribedStatus,
  type VideoStatsRow,
} from "../schemas";
import { pacificDate, reportRows, type AnalyticsQuery, type ReportRow } from "./analytics";

/**
 * The YouTube Analytics queries ingest runs, and pure parsers for their
 * results. Shapes were confirmed against a real channel in Phase 03
 * (`scripts/probe-analytics.ts`): a `video==` filter may list several videos
 * when `video` is also a dimension, which the documentation does not say.
 */

/** Video IDs per `video==` filter. The API accepts up to 500; 25 keeps requests small. */
export const VIDEOS_PER_QUERY = 25;

export interface VideoBatch {
  videoIds: string[];
  /** The earliest publish date in the batch, Pacific time. */
  startDate: string;
  endDate: string;
}

const STATUSES: readonly SubscribedStatus[] = subscribedStatusSchema.options;

/** The batch's videos as a `video==` filter. */
const videoFilter = (batch: VideoBatch) => `video==${batch.videoIds.join(",")}`;

/** Inclusive number of days from `startDate` to `endDate`. */
export function daysInRange(startDate: string, endDate: string): number {
  return Math.round((Date.parse(endDate) - Date.parse(startDate)) / 86_400_000) + 1;
}

/**
 * Groups videos into query batches, oldest first, so each batch's date range
 * starts at its own oldest video. `maxSize(days)` caps a batch given the days
 * its range would cover. Videos published after `endDate` have no data yet
 * and are left out.
 */
export function videoBatches(
  videos: ReadonlyArray<{ id: string; publishedAt: string }>,
  endDate: string,
  maxSize: (days: number) => number = () => VIDEOS_PER_QUERY,
): VideoBatch[] {
  const dated = videos
    .map((video) => ({ id: video.id, date: pacificDate(new Date(video.publishedAt)) }))
    .filter((video) => video.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const batches: VideoBatch[] = [];
  for (let index = 0; index < dated.length;) {
    const startDate = dated[index]?.date as string;
    const size = Math.max(1, Math.floor(maxSize(daysInRange(startDate, endDate))));
    const slice = dated.slice(index, index + size);
    batches.push({ videoIds: slice.map((video) => video.id), startDate, endDate });
    index += slice.length;
  }
  return batches;
}

/** Content type per video: `dimensions=video,creatorContentType`. */
export function contentTypeQuery(batch: VideoBatch): AnalyticsQuery {
  return {
    startDate: batch.startDate,
    endDate: batch.endDate,
    dimensions: "video,creatorContentType",
    metrics: "views",
    filters: videoFilter(batch),
  };
}

/**
 * The API returns content types in camelCase (`videoOnDemand`, `shorts`)
 * although the documentation lists `VIDEO_ON_DEMAND`, `SHORTS`; rows store the
 * documented form.
 */
export function normalizeContentType(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
}

/**
 * Pure parser: each video's content type. A video with rows for several types
 * takes the one with the most views. Videos with no data are absent.
 */
export function parseContentTypes(body: unknown): Map<string, string> {
  const best = new Map<string, { type: string; views: number }>();
  for (const row of reportRows(body)) {
    const video = String(row.video);
    const type = normalizeContentType(String(row.creatorContentType));
    const views = Number(row.views ?? 0);
    const current = best.get(video);
    if (!current || views > current.views) best.set(video, { type, views });
  }
  return new Map([...best].map(([video, { type }]) => [video, type]));
}

/** Rows keyed by `video|status`, refusing rows for videos the batch did not ask for. */
function rowsByVideoAndStatus(
  body: unknown,
  videoIds: readonly string[],
): Map<string, ReportRow[]> {
  const requested = new Set(videoIds);
  const grouped = new Map<string, ReportRow[]>();
  for (const row of reportRows(body)) {
    const video = String(row.video);
    if (!requested.has(video))
      throw new Error(`Analytics returned a row for unrequested video ${video}`);
    const status = subscribedStatusSchema.parse(row.subscribedStatus);
    const key = `${video}|${status}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  return grouped;
}

export const STATS_METRICS =
  "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage";

/** Lifetime totals per video and subscribed status: `dimensions=video,subscribedStatus`. */
export function statsQuery(batch: VideoBatch): AnalyticsQuery {
  return {
    startDate: batch.startDate,
    endDate: batch.endDate,
    dimensions: "video,subscribedStatus",
    metrics: STATS_METRICS,
    filters: videoFilter(batch),
  };
}

/**
 * Pure parser: exactly one `video_stats` row per requested video and
 * subscribed status. Analytics leaves out slices without data; those become
 * zero views with null averages, never an error.
 */
export function parseStats(
  body: unknown,
  { channelId, asOf, videoIds }: { channelId: string; asOf: string; videoIds: readonly string[] },
): VideoStatsRow[] {
  const grouped = rowsByVideoAndStatus(body, videoIds);
  return videoIds.flatMap((videoId) =>
    STATUSES.map((status) => {
      const rows = grouped.get(`${videoId}|${status}`) ?? [];
      if (rows.length > 1)
        throw new Error(`Analytics returned ${rows.length} rows for ${videoId} ${status}`);
      const [row] = rows;
      const views = Number(row?.views ?? 0);
      return videoStatsRowSchema.parse({
        channel_id: channelId,
        video_id: videoId,
        subscribed_status: status,
        views,
        engaged_views: Number(row?.engagedViews ?? 0),
        estimated_minutes_watched: Number(row?.estimatedMinutesWatched ?? 0),
        average_view_duration_s: row && views > 0 ? Number(row.averageViewDuration) : null,
        average_view_percentage: row && views > 0 ? Number(row.averageViewPercentage) : null,
        as_of: asOf,
      });
    }),
  );
}
