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
