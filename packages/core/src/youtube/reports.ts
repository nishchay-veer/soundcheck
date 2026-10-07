import {
  deviceMixRowSchema,
  subscribedStatusSchema,
  trafficMixRowSchema,
  videoStatsRowSchema,
  type DeviceBucket,
  type DeviceMixRow,
  type SubscribedStatus,
  type TrafficBucket,
  type TrafficMixRow,
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

/** Requested for both mix reports; `estimatedMinutesWatched` is kept in the raw archive only. */
export const MIX_METRICS = "views,engagedViews,estimatedMinutesWatched";

/** The traffic source report errors when videos × days in range exceeds this. */
export const TRAFFIC_VIDEO_DAYS_LIMIT = 50_000;

/** Videos per traffic query for a range of `days`: `floor(50000 / days)`, between 1 and 25. */
export function trafficBatchSize(days: number): number {
  return Math.max(1, Math.min(VIDEOS_PER_QUERY, Math.floor(TRAFFIC_VIDEO_DAYS_LIMIT / days)));
}

/** `insightTrafficSourceType` values per bucket; anything else is `other`. */
const TRAFFIC_BUCKETS: Record<string, TrafficBucket> = {
  YT_SEARCH: "search",
  RELATED_VIDEO: "suggested",
  END_SCREEN: "suggested",
  SUBSCRIBER: "browse",
  NOTIFICATION: "browse",
  YT_CHANNEL: "browse",
  PLAYLIST: "browse",
  EXT_URL: "external",
  NO_LINK_EMBEDDED: "external",
  NO_LINK_OTHER: "external",
};

/** `deviceType` values per bucket; anything else is `other`. */
const DEVICE_BUCKETS: Record<string, DeviceBucket> = {
  MOBILE: "mobile",
  TABLET: "mobile",
  TV: "tv",
  GAME_CONSOLE: "tv",
  DESKTOP: "desktop",
};

export const trafficBucket = (rawType: string): TrafficBucket =>
  TRAFFIC_BUCKETS[rawType] ?? "other";
export const deviceBucket = (rawType: string): DeviceBucket => DEVICE_BUCKETS[rawType] ?? "other";

function mixQuery(batch: VideoBatch, dimension: string): AnalyticsQuery {
  return {
    startDate: batch.startDate,
    endDate: batch.endDate,
    dimensions: `video,${dimension},subscribedStatus`,
    metrics: MIX_METRICS,
    filters: videoFilter(batch),
  };
}

/** Traffic sources per video and subscribed status. Batch with `trafficBatchSize`. */
export const trafficQuery = (batch: VideoBatch): AnalyticsQuery =>
  mixQuery(batch, "insightTrafficSourceType");

/** Device types per video and subscribed status. */
export const deviceQuery = (batch: VideoBatch): AnalyticsQuery => mixQuery(batch, "deviceType");

interface MixContext {
  channelId: string;
  asOf: string;
  videoIds: readonly string[];
}

/** Shared by both mix parsers: one row per raw type with views, its share of the slice. */
function parseMix(body: unknown, dimension: string, { channelId, asOf, videoIds }: MixContext) {
  const rows = [];
  for (const [key, group] of rowsByVideoAndStatus(body, videoIds)) {
    const [videoId, status] = key.split("|") as [string, SubscribedStatus];
    const types = group.map((row) => String(row[dimension]));
    const duplicate = types.find((type, index) => types.indexOf(type) !== index);
    if (duplicate)
      throw new Error(`Analytics returned ${duplicate} twice for ${videoId} ${status}`);
    const total = group.reduce((sum, row) => sum + Number(row.views ?? 0), 0);
    for (const row of group) {
      const views = Number(row.views ?? 0);
      if (views === 0) continue;
      rows.push({
        channel_id: channelId,
        video_id: videoId,
        subscribed_status: status,
        raw_type: String(row[dimension]),
        views,
        engaged_views: Number(row.engagedViews ?? 0),
        share: views / total,
        as_of: asOf,
      });
    }
  }
  return rows;
}

/**
 * Pure parser for the traffic source report. Slices with no views produce no
 * rows (absence is zero, never an error); zero-view sources are dropped.
 */
export function parseTrafficMix(body: unknown, context: MixContext): TrafficMixRow[] {
  return parseMix(body, "insightTrafficSourceType", context).map((row) =>
    trafficMixRowSchema.parse({ ...row, bucket: trafficBucket(row.raw_type) }),
  );
}

/** Pure parser for the device type report, like `parseTrafficMix`. */
export function parseDeviceMix(body: unknown, context: MixContext): DeviceMixRow[] {
  return parseMix(body, "deviceType", context).map((row) =>
    deviceMixRowSchema.parse({ ...row, bucket: deviceBucket(row.raw_type) }),
  );
}
