import { z } from "zod";
import { beatTypeSchema, musicSchema, videoFormatSchema, visualSchema } from "./beats";
import { channelIdSchema } from "./channels";
import {
  audienceKeySchema,
  bandSchema,
  modelStampSchema,
  percentilesSchema,
  videoBeatSchema,
  videoIdSchema,
} from "./documents";

/**
 * Soundchecks (Phases 14 and 15): a new cut, uploaded as a file or linked on
 * YouTube, with its predicted curves and suggested edits. (Scripts are left
 * out for now, by Nishchay's decision.) The soundcheck job writes two documents under the channel, so
 * disconnecting deletes both:
 *
 * - `channels/{channelId}/soundchecks/{id}`: what the screens show;
 * - `…/soundchecks/{id}/inputs/current`: the cut as the model reads it, so the
 *   edit simulator (Phase 15) needs neither BigQuery nor Gemini.
 *
 * Units as in `documents.ts`: shares are fractions, `avp` is a percentage of
 * the video, times are seconds.
 */

const isoDateTime = z.iso.datetime();
const share = z.number().min(0).max(1);
const seconds = z.number().nonnegative();
const rating = z.number().int().min(1).max(5);

/** Shares that must sum to 1: allows float rounding. */
const SUM_TOLERANCE = 1e-6;

export const soundcheckIdSchema = z.string().regex(/^[0-9a-f]{32}$/);

/** What a soundcheck accepts. */
export const SOUNDCHECK_LIMITS = {
  /** Gemini reads Cloud Storage files up to 2 GB (Phase 14's probe and the docs). */
  maxUploadBytes: 2 * 1024 ** 3,
  /** Shorter cuts would be Shorts, which the models leave out. */
  minDurationS: 60,
  maxDurationS: 60 * 60,
  /** YouTube's own title limit. */
  maxTitleChars: 100,
} as const;

/** Video files a creator can upload. */
export const uploadTypeSchema = z.enum(["video/mp4", "video/quicktime", "video/webm"]);
export type UploadType = z.infer<typeof uploadTypeSchema>;

/** The extension each upload type is stored with. */
export const UPLOAD_EXTENSIONS: Record<UploadType, string> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
};

/** Where an upload is stored in the uploads bucket: `{channel}/{id}/source.{ext}`. */
export const uploadObjectName = (channelId: string, soundcheckId: string, type: UploadType) =>
  `${channelId}/${soundcheckId}/source.${UPLOAD_EXTENSIONS[type]}`;

const UPLOAD_OBJECT = /^(UC[\w-]{22})\/([0-9a-f]{32})\/source\.(mp4|mov|webm)$/;

/** The soundcheck an uploaded object belongs to, or null for any other object. */
export function parseUploadObjectName(
  name: string,
): { channelId: string; soundcheckId: string } | null {
  const match = UPLOAD_OBJECT.exec(name);
  return match ? { channelId: match[1] as string, soundcheckId: match[2] as string } : null;
}

const YOUTUBE_HOSTS = new Set(["youtube.com", "www.youtube.com", "m.youtube.com"]);
const VIDEO_ID = /^[\w-]{11}$/;

/**
 * The video ID in a YouTube link (watch, youtu.be, shorts, live and embed
 * links, with or without other parameters), or in a bare ID; null otherwise.
 */
export function parseYouTubeLink(text: string): string | null {
  const value = text.trim();
  if (VIDEO_ID.test(value)) return value;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  let id: string | null | undefined = null;
  if (host === "youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [, first, second] = url.pathname.split("/");
    id =
      first === "watch"
        ? url.searchParams.get("v")
        : first === "shorts" || first === "live" || first === "embed"
          ? second
          : null;
  }
  return id && VIDEO_ID.test(id) ? id : null;
}

// What the creator gave us ----------------------------------------------------

/** "Expected traffic": who the creator expects to watch, which sets the audience mix. */
export const scenarioSchema = z.enum(["recent", "search", "suggested", "subscribers"]);
export type Scenario = z.infer<typeof scenarioSchema>;

export const SCENARIO_LABELS: Record<Scenario, string> = {
  recent: "Like my recent videos",
  search: "Mostly search",
  suggested: "Mostly suggested",
  subscribers: "Mostly subscribers",
};

export const soundcheckInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    /** Its name on the creator's computer, for display. */
    fileName: z.string().min(1).max(255),
    contentType: uploadTypeSchema,
    sizeBytes: z.number().int().positive().max(SOUNDCHECK_LIMITS.maxUploadBytes),
    /** `gs://{uploads bucket}/{channel}/{id}/source.{ext}` */
    uri: z.string().regex(/^gs:\/\/[^/]+\/.+/),
  }),
  /** A public or unlisted YouTube video; private ones cannot be watched. */
  z.object({ kind: z.literal("youtube"), videoId: videoIdSchema }),
]);
export type SoundcheckInput = z.infer<typeof soundcheckInputSchema>;
export type SoundcheckKind = SoundcheckInput["kind"];

// Progress and failure ---------------------------------------------------------

/**
 * `awaiting_upload` until a file arrives; `queued` once the workflow is
 * started; `running` while the job works; then `ready` or `failed`.
 */
export const soundcheckStatusSchema = z.enum([
  "awaiting_upload",
  "queued",
  "running",
  "ready",
  "failed",
]);
export type SoundcheckStatus = z.infer<typeof soundcheckStatusSchema>;

/** The job's steps. */
export const soundcheckStepSchema = z.enum([
  "checking",
  "watching",
  "predicting",
  "suggesting",
  "finishing",
]);
export type SoundcheckStep = z.infer<typeof soundcheckStepSchema>;

export const soundcheckProgressSchema = z
  .object({
    step: soundcheckStepSchema,
    /** What is happening, in plain words: "Watching your video", "Found 23 beats". */
    message: z.string().min(1),
    /** Steps finished, of all the job's steps, for a progress bar. */
    done: z.number().int().nonnegative(),
    total: z.number().int().positive(),
  })
  .refine((progress) => progress.done <= progress.total, {
    message: "Cannot finish more steps than there are",
  });
export type SoundcheckProgress = z.infer<typeof soundcheckProgressSchema>;

/** Why a soundcheck failed; each has its own message and remedy on screen. */
export const soundcheckErrorCodeSchema = z.enum([
  /** A private YouTube video: set it to unlisted, or upload the file. */
  "private_video",
  /** A link to a video that does not exist or was removed. */
  "video_unavailable",
  "too_short",
  "too_long",
  "too_large",
  "unsupported_type",
  /** The upload never finished. */
  "upload_missing",
  /** The channel has no fitted models yet. */
  "no_model",
  /** Gemini's answer failed validation, even after a retry with the errors. */
  "unreadable",
  "internal",
]);
export type SoundcheckErrorCode = z.infer<typeof soundcheckErrorCodeSchema>;

export const soundcheckErrorSchema = z.object({
  code: soundcheckErrorCodeSchema,
  /** What went wrong and what to do, in plain words. */
  message: z.string().min(1),
});
export type SoundcheckError = z.infer<typeof soundcheckErrorSchema>;

// The prediction ---------------------------------------------------------------

/** One audience's predicted curve and totals. */
export const predictedAudienceSchema = z.object({
  band: bandSchema,
  /** Average view duration, in seconds. */
  avdS: percentilesSchema,
  /** Average view percentage, 0 to 100. */
  avp: percentilesSchema,
  model: modelStampSchema,
});
export type PredictedAudience = z.infer<typeof predictedAudienceSchema>;

/** Each measured audience's share of the views, summing to 1. */
export const audienceWeightsSchema = z
  .object({ subscribed: share, unsubscribed: share })
  .refine((weights) => Math.abs(weights.subscribed + weights.unsubscribed - 1) <= SUM_TOLERANCE, {
    message: "Audience weights must sum to 1",
  });
export type AudienceWeights = z.infer<typeof audienceWeightsSchema>;

export const soundcheckPredictionSchema = z
  .object({
    audiences: z.object({
      subscribed: predictedAudienceSchema.optional(),
      unsubscribed: predictedAudienceSchema.optional(),
    }),
    /** How the audiences were combined: the scenario's expected share of views. */
    weights: audienceWeightsSchema,
    /** Both audiences together, weighted. */
    avdS: percentilesSchema,
    avp: percentilesSchema,
    /** Where the median predicted average view percentage falls among recent videos, 0 to 100. */
    percentileVsChannel: z.number().min(0).max(100).nullable(),
    /** How many recent videos it was compared with; 0 leaves the percentile null. */
    comparedVideos: z.number().int().nonnegative(),
  })
  .refine(
    (prediction) => Boolean(prediction.audiences.subscribed ?? prediction.audiences.unsubscribed),
    {
      message: "A prediction needs at least one audience",
      path: ["audiences"],
    },
  )
  .refine(
    (prediction) => (prediction.comparedVideos === 0) === (prediction.percentileVsChannel === null),
    {
      message: "A percentile needs videos to compare with",
      path: ["percentileVsChannel"],
    },
  );
export type SoundcheckPrediction = z.infer<typeof soundcheckPredictionSchema>;

/**
 * One suggested edit to a new cut, simulated on the cut's beats. `params`
 * hold the op's numbers (seconds, a target index); Phase 15 tightens them.
 */
export const editSchema = z.object({
  editId: z.string().min(1),
  op: z.enum(["remove", "trim", "move"]),
  beatIndex: z.number().int().nonnegative(),
  params: z.record(z.string(), z.number()),
  label: z.string().min(1),
  rationale: z.string().min(1),
  /** Change in average view percentage, in percentage points. */
  deltaAvpPp: percentilesSchema,
  /** Change in average view duration, in seconds. */
  deltaAvdS: percentilesSchema,
  /** The audience the change mostly comes from. */
  audienceDriver: audienceKeySchema,
});
export type Edit = z.infer<typeof editSchema>;

// channels/{channelId}/soundchecks/{id} ----------------------------------------

export const soundcheckDocSchema = z
  .object({
    soundcheckId: soundcheckIdSchema,
    channelId: channelIdSchema,
    status: soundcheckStatusSchema,
    /** The working title; empty when the creator gave none. */
    title: z.string().max(SOUNDCHECK_LIMITS.maxTitleChars),
    scenario: scenarioSchema,
    input: soundcheckInputSchema,
    progress: soundcheckProgressSchema.nullable(),
    error: soundcheckErrorSchema.nullable(),
    /** Unknown until the cut is read. */
    durationS: z.number().positive().nullable(),
    beats: z.array(videoBeatSchema).nullable(),
    prediction: soundcheckPredictionSchema.nullable(),
    edits: z.array(editSchema),
    narrative: z.string().nullable(),
    extractionVersion: z.string().min(1),
    featureVersion: z.string().min(1),
    createdAt: isoDateTime,
    updatedAt: isoDateTime,
  })
  .refine((doc) => (doc.status === "failed") === (doc.error !== null), {
    message: "A failed soundcheck has an error, and only a failed one",
    path: ["error"],
  })
  .refine(
    (doc) =>
      doc.status !== "ready" ||
      (doc.prediction !== null && doc.beats !== null && doc.durationS !== null),
    { message: "A ready soundcheck has its length, beats and prediction", path: ["prediction"] },
  )
  .refine((doc) => doc.status !== "awaiting_upload" || doc.input.kind === "file", {
    message: "Only a file waits for an upload",
    path: ["status"],
  });
export type SoundcheckDoc = z.infer<typeof soundcheckDocSchema>;

// channels/{channelId}/soundchecks/{id}/inputs/current -------------------------

/**
 * A beat as the featurizer reads it. Transcripts are not kept: the features
 * only ask whether anything is said, and the speech rate.
 */
export const featureBeatInputSchema = z
  .object({
    startS: seconds,
    endS: seconds,
    beatType: beatTypeSchema,
    talkingHeadShare: rating,
    visual: visualSchema,
    cutsPerMin: z.number().nonnegative(),
    onScreenText: z.boolean(),
    music: musicSchema,
    energy: rating,
    assumedKnowledge: rating,
    infoDensity: rating,
    opensLoop: z.boolean(),
    closesLoop: z.boolean(),
    speaks: z.boolean(),
    wordsPerMinute: z.number().nonnegative(),
  })
  .refine((beat) => beat.endS > beat.startS, { message: "A beat must end after it starts" });
export type FeatureBeatInput = z.infer<typeof featureBeatInputSchema>;

/** Shares of newcomer views by traffic source, each 0 to 1. */
export const trafficMixSchema = z.object({ search: share, suggested: share, browse: share });

/** The model an audience is predicted with. */
export const modelRefSchema = z.object({
  /** The artifact JSON in Cloud Storage. */
  artifactUri: z.string().regex(/^gs:\/\/[^/]+\/.+/),
  /** The held-out evaluation's calibration factor for the bands; 1 without one. */
  inflation: z.number().positive(),
  stamp: modelStampSchema,
});
export type ModelRef = z.infer<typeof modelRefSchema>;

export const soundcheckInputsSchema = z
  .object({
    soundcheckId: soundcheckIdSchema,
    channelId: channelIdSchema,
    durationS: z.number().positive(),
    video: z.object({
      format: videoFormatSchema,
      targetLevel: rating,
      payoffTimeS: seconds.nullable(),
    }),
    beats: z.array(featureBeatInputSchema).min(1),
    /** The channel numbers the features are measured against. */
    channel: z.object({ medianTargetLevel: z.number(), mixMean: trafficMixSchema }),
    scenario: scenarioSchema,
    /** The newcomers' traffic mix under the scenario. */
    mix: trafficMixSchema,
    weights: audienceWeightsSchema,
    models: z
      .object({ subscribed: modelRefSchema.optional(), unsubscribed: modelRefSchema.optional() })
      .refine((models) => Boolean(models.subscribed ?? models.unsubscribed), {
        message: "At least one audience needs a model",
      }),
    /**
     * Every prediction of this cut draws its coefficient samples from this
     * seed (common random numbers), so edits are compared on the same draws.
     */
    seed: z.number().int().nonnegative(),
    createdAt: isoDateTime,
  })
  .refine((inputs) => inputs.beats.every((beat) => beat.endS <= inputs.durationS + 1e-6), {
    message: "Every beat must end within the cut",
    path: ["beats"],
  });
export type SoundcheckInputs = z.infer<typeof soundcheckInputsSchema>;
