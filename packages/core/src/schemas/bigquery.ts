import { z } from "zod";
import { channelIdSchema } from "./channels";

/**
 * BigQuery rows, as written to NDJSON for load jobs: timestamps are ISO 8601
 * strings and dates `YYYY-MM-DD`. Column names match `infra/bigquery/*.sql`.
 */

const timestamp = z.iso.datetime({ offset: true });

/** Why a video is not used for training; the first rule it fails. */
export const exclusionReasonSchema = z.enum([
  "content_type_unknown",
  "unsupported_content_type",
  "too_short",
  "too_long",
  "too_recent",
  "too_few_views",
]);
export type ExclusionReason = z.infer<typeof exclusionReasonSchema>;

/** `videos`: Data API metadata plus the Analytics content type and training eligibility. */
export const videoRowSchema = z
  .object({
    channel_id: channelIdSchema,
    video_id: z.string().min(1),
    title: z.string().nullable(),
    description: z.string().nullable(),
    published_at: timestamp,
    duration_s: z.number().int().nonnegative(),
    /** `VIDEO_ON_DEMAND`, `SHORTS`, `LIVE_STREAM`, …; null when Analytics has no data for it. */
    content_type: z.string().nullable(),
    /** Has live-streaming details: a live stream or a premiere. */
    is_live: z.boolean(),
    category_id: z.string().nullable(),
    tags: z.array(z.string()),
    thumbnail_url: z.url().nullable(),
    default_language: z.string().nullable(),
    eligible: z.boolean(),
    exclusion_reason: exclusionReasonSchema.nullable(),
    ingested_at: timestamp,
  })
  .refine((row) => row.eligible === (row.exclusion_reason === null), {
    message: "an eligible video has no exclusion reason, and an excluded one has exactly one",
    path: ["exclusion_reason"],
  });
export type VideoRow = z.infer<typeof videoRowSchema>;

export const subscribedStatusSchema = z.enum(["SUBSCRIBED", "UNSUBSCRIBED"]);
export type SubscribedStatus = z.infer<typeof subscribedStatusSchema>;

const count = z.number().int().nonnegative();
const date = z.iso.date();

/**
 * `video_stats`: lifetime totals per video and subscribed status, from
 * publication to `as_of`. Labels and weights only, never features (rule 8). A
 * slice with no Analytics data has zero views and null averages.
 */
export const videoStatsRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  subscribed_status: subscribedStatusSchema,
  views: count,
  /** Views past the first frame: the meaning `views` had before Aug 27, 2026. */
  engaged_views: count,
  estimated_minutes_watched: z.number().nonnegative(),
  average_view_duration_s: z.number().nonnegative().nullable(),
  /** Can exceed 100 when viewers rewatch, as Shorts loop. */
  average_view_percentage: z.number().nonnegative().nullable(),
  as_of: date,
});
export type VideoStatsRow = z.infer<typeof videoStatsRowSchema>;

export const trafficBucketSchema = z.enum(["search", "suggested", "browse", "external", "other"]);
export type TrafficBucket = z.infer<typeof trafficBucketSchema>;
export const deviceBucketSchema = z.enum(["mobile", "tv", "desktop", "other"]);
export type DeviceBucket = z.infer<typeof deviceBucketSchema>;

/**
 * A mix row: one raw traffic source or device type for a video and subscribed
 * status, the bucket it maps to, and its share of that slice's views. Shares
 * of a video and status sum to 1; a slice with no views has no rows.
 */
const mixRowShape = {
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  subscribed_status: subscribedStatusSchema,
  raw_type: z.string().min(1),
  views: z.number().int().positive(),
  engaged_views: count,
  share: z.number().positive().max(1),
  as_of: date,
};

/** `video_traffic_mix`. */
export const trafficMixRowSchema = z.object({ ...mixRowShape, bucket: trafficBucketSchema });
export type TrafficMixRow = z.infer<typeof trafficMixRowSchema>;

/** `video_device_mix`. */
export const deviceMixRowSchema = z.object({ ...mixRowShape, bucket: deviceBucketSchema });
export type DeviceMixRow = z.infer<typeof deviceMixRowSchema>;
