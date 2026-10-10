import { z } from "zod";
import { channelIdSchema } from "./channels";
import { featureSpecDocumentSchema } from "./features";

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

/** Audiences with a measured retention curve; user-facing text calls these audiences too. */
export const audienceSchema = z.enum(["all", "subscribed", "unsubscribed", "organic"]);
export type Audience = z.infer<typeof audienceSchema>;

/**
 * `retention_curves`: one row per video, audience and bin of the 100-point
 * timeline (bin 1 is elapsed ratio 0.01). Raw API values plus the derived
 * monotone survival and hazard (labels for Phase 08, never features).
 * `started_watching` and `stopped_watching` are null when YouTube does not
 * return them.
 */
export const retentionCurveRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  audience: audienceSchema,
  bin: z.number().int().min(1).max(100),
  elapsed_ratio: z.number().positive().max(1),
  audience_watch_ratio: z.number().nonnegative(),
  relative_retention: z.number().nonnegative().nullable(),
  started_watching: count.nullable(),
  stopped_watching: count.nullable(),
  total_segment_impressions: z.number().nonnegative().nullable(),
  s_mono: z.number().min(0).max(1),
  hazard: z.number().min(0).max(0.999),
  as_of: date,
});
export type RetentionCurveRow = z.infer<typeof retentionCurveRowSchema>;

/**
 * - `complete`: all 100 points arrived.
 * - `partial`: some arrived; stored as is, never filled in.
 * - `insufficient_data`: an empty response, because too few views.
 * - `skipped`: not requested, e.g. `organic` when ads bring 2% of views or less.
 */
export const coverageStatusSchema = z.enum(["complete", "partial", "insufficient_data", "skipped"]);
export type CoverageStatus = z.infer<typeof coverageStatusSchema>;

/**
 * `retention_coverage`: whether each video and audience has a measured curve.
 * `details` says why not, and whether the segment counts (`startedWatching`,
 * `stoppedWatching`) were available.
 */
export const retentionCoverageRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  audience: audienceSchema,
  status: coverageStatusSchema,
  points: z.number().int().min(0).max(100),
  /** Points that rise more than 0.02 over the previous one; null without a curve. */
  rewatch_bumps: count.nullable(),
  /** Sum of the watch ratio above monotone survival. An outcome, never a feature. */
  rewatch_mass: z.number().nonnegative().nullable(),
  as_of: date,
  details: z.record(z.string(), z.unknown()).nullable(),
});
export type RetentionCoverageRow = z.infer<typeof retentionCoverageRowSchema>;

/**
 * How one video's extraction ended:
 * - `extracted`: Gemini answered and the beats passed validation;
 * - `cached`: a validated extraction for the same key already existed;
 * - `invalid`: the answer failed validation twice (the retry included the errors);
 * - `private_unavailable`: a private video, which Gemini cannot read from YouTube;
 * - `failed`: the Gemini call itself failed.
 */
export const extractionStatusSchema = z.enum([
  "extracted",
  "cached",
  "invalid",
  "private_unavailable",
  "failed",
]);
export type ExtractionStatus = z.infer<typeof extractionStatusSchema>;

/** `beats`: one row per beat. The typed per-beat features are in `details`. */
export const beatRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  extraction_version: z.string().min(1),
  beat_index: z.number().int().nonnegative(),
  start_s: z.number().nonnegative(),
  end_s: z.number().positive(),
  beat_type: z.string().min(1),
  extracted_at: timestamp,
  details: z.record(z.string(), z.unknown()),
});
export type BeatRow = z.infer<typeof beatRowSchema>;

/** `beat_videos`: one row per video and extraction, with the video-level answers. */
export const beatVideoRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  extraction_version: z.string().min(1),
  cache_key: z.string().regex(/^[0-9a-f]{64}$/),
  gemini_model: z.string().min(1),
  video_mode: z.string().min(1),
  format: z.string().min(1),
  video_summary: z.string(),
  title_promise: z.string(),
  target_level: z.number().int().min(1).max(5),
  payoff_time_s: z.number().nonnegative().nullable(),
  beat_count: z.number().int().positive(),
  coverage: z.number().min(0).max(1),
  duration_s: z.number().positive(),
  extracted_at: timestamp,
});
export type BeatVideoRow = z.infer<typeof beatVideoRowSchema>;

/**
 * `extraction_runs`: one row per video per `extract beats` run, cache hits
 * included, with token counts, latency, cost and each Gemini call in `details`.
 */
export const extractionRunRowSchema = z.object({
  run_id: z.string().min(1),
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  extraction_version: z.string().min(1),
  gemini_model: z.string().nullable(),
  status: extractionStatusSchema,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type ExtractionRunRow = z.infer<typeof extractionRunRowSchema>;

/** `quality_reports`: one data-quality report from any stage, with the findings in `details`. */
export const qualityReportRowSchema = z.object({
  report_id: z.string().regex(/^[\w-]+$/),
  channel_id: channelIdSchema,
  stage: z.string().min(1),
  run_id: z.string().nullable(),
  created_at: timestamp,
  details: z.record(z.string(), z.unknown()),
});
export type QualityReportRow = z.infer<typeof qualityReportRowSchema>;

/** The audiences the hazard model is trained for (Phase 07 and 08). */
export const trainingAudienceSchema = audienceSchema.extract(["all", "subscribed", "unsubscribed"]);
export type TrainingAudience = z.infer<typeof trainingAudienceSchema>;

/**
 * `training_bins`: one row per video, audience and bin. `hazard` is the label,
 * `n_at_risk` and `video_views` are weights (outcomes, never features), and
 * `x` is the feature vector in the order of `feature_specs` for
 * `feature_version`.
 */
export const trainingBinRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  audience: trainingAudienceSchema,
  bin: z.number().int().min(1).max(100),
  hazard: z.number().min(0).max(0.999),
  /** The audience's views times survival at the start of the bin. */
  n_at_risk: z.number().nonnegative(),
  /** The audience's views of the video. */
  video_views: count,
  feature_version: z.string().min(1),
  extraction_version: z.string().min(1),
  /** The data date of the retention curve. */
  as_of: date,
  x: z.array(z.number().refine(Number.isFinite, "must be finite")).min(1),
});
export type TrainingBinRow = z.infer<typeof trainingBinRowSchema>;

/** `feature_specs`: the feature spec of each feature version, so Python can name the columns of `x`. */
export const featureSpecRowSchema = z.object({
  feature_version: z.string().min(1),
  spec: featureSpecDocumentSchema,
  created_at: timestamp,
});
export type FeatureSpecRow = z.infer<typeof featureSpecRowSchema>;

/** `channel_id` of the pooled model's runs, fitted across every usable channel. */
export const POOLED_CHANNEL = "pooled";

/**
 * How one audience's fit ended: `fitted` (artifact written; it says whether
 * it is usable), `not_converged` (no artifact: a model that did not converge
 * is never shipped), `no_data` (no rows for the audience) or `failed`.
 */
export const modelRunStatusSchema = z.enum(["fitted", "not_converged", "no_data", "failed"]);
export type ModelRunStatus = z.infer<typeof modelRunStatusSchema>;

/** `model_runs`: one row per fit of one audience's model, written by the Python fitter. */
export const modelRunRowSchema = z.object({
  run_id: z.string().regex(/^[\w-]+$/),
  channel_id: z.union([channelIdSchema, z.literal(POOLED_CHANNEL)]),
  audience: trainingAudienceSchema,
  model_version: z.string().min(1),
  feature_version: z.string().min(1),
  status: modelRunStatusSchema,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  artifact_uri: z.string().startsWith("gs://").nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type ModelRunRow = z.infer<typeof modelRunRowSchema>;

/**
 * `feature_contexts`: the channel context a channel's `training_bins` were
 * built with, one row per channel. The fitter copies it into every model
 * artifact so predictions measure features the same way.
 */
export const featureContextRowSchema = z.object({
  channel_id: channelIdSchema,
  feature_version: z.string().min(1),
  extraction_version: z.string().min(1),
  median_target_level: z.number().min(1).max(5),
  mix_mean_search: z.number().min(0).max(1),
  mix_mean_suggested: z.number().min(0).max(1),
  mix_mean_browse: z.number().min(0).max(1),
  /** The videos with rows in `training_bins`. */
  video_ids: z.array(z.string().min(1)).min(1),
  as_of: date,
  created_at: timestamp,
});
export type FeatureContextRow = z.infer<typeof featureContextRowSchema>;

/**
 * `baseline_llm_curves`: the generic-LLM baseline (Phase 09, B1), one row per
 * video and prompt: Gemini's 20-point guess for a typical YouTube audience and
 * its 100-point interpolation, comparable to a measured `s_mono` curve.
 */
export const baselineLlmCurveRowSchema = z.object({
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  prompt_version: z.string().min(1),
  gemini_model: z.string().min(1),
  video_mode: z.string().min(1),
  cache_key: z.string().regex(/^[0-9a-f]{64}$/),
  /** Share still watching at 5%, 10% … 100% of the video. */
  points: z.array(z.number().min(0).max(1)).length(20),
  /** Share still watching at the end of each of the 100 bins. */
  curve: z.array(z.number().min(0).max(1)).length(100),
  /** True when Gemini's points rose somewhere and were made non-increasing. */
  repaired: z.boolean(),
  cost_usd: z.number().nonnegative().nullable(),
  created_at: timestamp,
});
export type BaselineLlmCurveRow = z.infer<typeof baselineLlmCurveRowSchema>;

/**
 * How an evaluation ended (Phase 09): `holdout` (a real held-out result),
 * `check` (a channel too small to hold videos out, each held out in turn: a
 * pipeline check, never a result) or `failed`.
 */
export const evalRunStatusSchema = z.enum(["holdout", "check", "failed"]);

/**
 * `eval_runs`: one row per evaluation of a channel, written by the Python
 * evaluator. `model_run_id` is the production run the evaluation vouches for
 * (the evaluation's own run when the channel has none); the scores, baselines,
 * calibration and bootstrap are in `details`.
 */
export const evalRunRowSchema = z.object({
  run_id: z.string().regex(/^[\w-]+$/),
  model_run_id: z.string().regex(/^[\w-]+$/),
  channel_id: channelIdSchema,
  model_version: z.string().min(1),
  feature_version: z.string().min(1),
  status: evalRunStatusSchema,
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  details: z.record(z.string(), z.unknown()),
});
export type EvalRunRow = z.infer<typeof evalRunRowSchema>;
