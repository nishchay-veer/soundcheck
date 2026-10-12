import { z } from "zod";
import { beatTypeSchema, visualSchema, wordCount } from "./beats";
import { channelIdSchema, runIdSchema } from "./channels";

/**
 * Serving documents (Phase 11): everything a screen shows, precomputed by the
 * publish job into Firestore so each screen is one read. Route handlers return
 * these documents as they are, so dates are ISO strings rather than Firestore
 * timestamps, and the pipeline that writes them and the web app that reads
 * them share one type each.
 *
 * Units: shares and survival are fractions from 0 to 1; `…Pp` values are
 * percentage points; times are seconds from the start of the video; bins run
 * from 1 to 100.
 */

/** A YouTube video ID: 11 URL-safe characters. */
export const videoIdSchema = z.string().regex(/^[\w-]{11}$/);

/** Bins on the relative timeline (Phase 07). */
export const TIMELINE_BINS = 100;

const isoDateTime = z.iso.datetime();
const share = z.number().min(0).max(1);
const seconds = z.number().nonnegative();
const bin = z.number().int().min(1).max(TIMELINE_BINS);

/** Text of at most `max` words. */
const limitedWords = (max: number) =>
  z
    .string()
    .min(1)
    .refine((text) => wordCount(text) <= max, { message: `At most ${max} words` });

/** Shares that, with the residual, account for a whole: allows float rounding. */
const SUM_TOLERANCE = 1e-6;

// Audiences ------------------------------------------------------------------

/** Audiences with their own measured retention curves. */
export const measuredAudienceSchema = z.enum(["subscribed", "unsubscribed"]);
export type MeasuredAudience = z.infer<typeof measuredAudienceSchema>;

/**
 * Every audience a card can describe. Search, suggested and browse are
 * newcomers by traffic source, estimated from the newcomer model; a card for
 * one is published only when the overview's identifiability rule allows it.
 */
export const audienceKeySchema = z.enum([
  "subscribed",
  "unsubscribed",
  "search",
  "suggested",
  "browse",
]);
export type AudienceKey = z.infer<typeof audienceKeySchema>;

/** What users see for each audience (rule 12: "audience", never "cohort"). */
export const AUDIENCE_LABELS: Record<AudienceKey, string> = {
  subscribed: "Subscribers",
  unsubscribed: "Newcomers",
  search: "Newcomers from search",
  suggested: "Newcomers from suggested videos",
  browse: "Newcomers from browse",
};

/**
 * The model behind a prediction. A model that is not usable (too few training
 * videos, or a fit that did not converge) is still published, so every screen
 * can be built and checked, but a screen must label its numbers "not a result
 * yet" (Phases 08 and 09).
 */
export const modelStampSchema = z
  .object({
    runId: runIdSchema,
    usable: z.boolean(),
    /** Why it is not usable, in plain words; empty when it is. */
    unusableReasons: z.array(z.string().min(1)),
    trainedVideos: z.number().int().nonnegative(),
  })
  .refine((model) => model.usable === (model.unusableReasons.length === 0), {
    message: "A model is usable exactly when it has no reasons against",
    path: ["unusableReasons"],
  });
export type ModelStamp = z.infer<typeof modelStampSchema>;

// Curves ---------------------------------------------------------------------

/** Share still watching at the end of each of the 100 bins. */
export const curveSchema = z.array(share).length(TIMELINE_BINS);

const ordered = (low: readonly number[], high: readonly number[]) =>
  low.every((value, i) => value <= (high[i] as number));

/** A predicted survival curve's 10th, 50th and 90th percentiles, per bin. */
export const bandSchema = z
  .object({ p10: curveSchema, p50: curveSchema, p90: curveSchema })
  .refine((band) => ordered(band.p10, band.p50) && ordered(band.p50, band.p90), {
    message: "Need p10 <= p50 <= p90 in every bin",
  });
export type Band = z.infer<typeof bandSchema>;

/** A predicted number, or change, as its 10th, 50th and 90th percentiles over sampled models. */
export const percentilesSchema = z
  .object({ p10: z.number(), p50: z.number(), p90: z.number() })
  .refine((value) => value.p10 <= value.p50 && value.p50 <= value.p90, {
    message: "Need p10 <= p50 <= p90",
  });
export type Percentiles = z.infer<typeof percentilesSchema>;

// channels/{id}/summary/current ----------------------------------------------

/**
 * A trait an audience card shows (Phase 08's simulated edits): one whose 90%
 * interval excludes zero.
 */
export const traitCardSchema = z
  .object({
    /** The trait's model feature, e.g. `beat_sponsor`. */
    feature: z.string().min(1),
    statement: z.string().min(1),
    /** Change in the share still watching at the end, in percentage points. */
    deltaPp: z.number(),
    /** The 90% interval of that change. */
    ci: z.tuple([z.number(), z.number()]),
  })
  .refine(({ ci: [low, high] }) => low <= high && (low > 0 || high < 0), {
    message: "A shown trait's interval must exclude zero",
    path: ["ci"],
  });
export type TraitCard = z.infer<typeof traitCardSchema>;

/**
 * One simulated effect in an audience's sheet: every scenario the model was
 * asked about, clear or not, so a creator sees what is unknown as well as what
 * is known. `deltaPp` and `ci` are null when the model never learned it (its
 * feature never varied in the training videos).
 */
export const effectSchema = z
  .object({
    feature: z.string().min(1),
    label: z.string().min(1),
    /** Change in the share still watching at the end, in percentage points. */
    deltaPp: z.number().nullable(),
    /** Its 90% interval. */
    ci: z.tuple([z.number(), z.number()]).nullable(),
  })
  .refine((effect) => (effect.deltaPp === null) === (effect.ci === null), {
    message: "An effect has both a value and an interval, or neither",
    path: ["ci"],
  })
  .refine((effect) => effect.ci === null || effect.ci[0] <= effect.ci[1], {
    message: "An interval runs from low to high",
    path: ["ci"],
  });
export type Effect = z.infer<typeof effectSchema>;

export const audienceCardSchema = z
  .object({
    key: audienceKeySchema,
    label: z.string().min(1),
    kind: z.enum(["measured", "estimated"]),
    /** The audience's share of the channel's views. */
    viewShare: share,
    /** Its share of watch time; null for estimated audiences (the traffic mix has none). */
    watchTimeShare: share.nullable(),
    /** YouTube's average view percentage, which counts rewatches and can pass 100; null for estimated audiences. */
    avgViewPct: z.number().nonnegative().nullable(),
    /** At most 3, by absolute effect. */
    traits: z.array(traitCardSchema).max(3),
    /** Every simulated effect, clear ones first by size, for the audience's sheet. */
    effects: z.array(effectSchema),
    description: limitedWords(30),
    /** Null when the audience has no fitted model: its measured numbers still show. */
    model: modelStampSchema.nullable(),
  })
  .refine(
    (card) =>
      card.kind === (measuredAudienceSchema.safeParse(card.key).success ? "measured" : "estimated"),
    { message: "Subscribers and newcomers are measured; the rest are estimated", path: ["kind"] },
  )
  .refine(
    (card) => card.model !== null || (card.traits.length === 0 && card.effects.length === 0),
    {
      message: "Traits and effects come from a model",
      path: ["traits"],
    },
  );
export type AudienceCard = z.infer<typeof audienceCardSchema>;

/**
 * The channel's latest held-out evaluation (Phase 09), for all viewers. Only a
 * `holdout` run qualifies; a check-mode run is never shown as a result.
 */
export const summaryEvaluationSchema = z.object({
  runId: runIdSchema,
  testVideos: z.number().int().positive(),
  /** Mean absolute curve error over bins 2 to 100. */
  modelErrorPp: z.number().nonnegative(),
  /** The same for B0, the channel average. */
  baselineErrorPp: z.number().nonnegative(),
  /** The bootstrap's 95% interval for model minus baseline lies entirely below zero. */
  beatsBaseline: z.boolean(),
});
export type SummaryEvaluation = z.infer<typeof summaryEvaluationSchema>;

/** `channels/{id}/summary/current`: the channel overview screen. */
export const summaryDocSchema = z
  .object({
    channelId: channelIdSchema,
    /** The publish run that wrote it. */
    runId: runIdSchema,
    generatedAt: isoDateTime,
    videosAnalysed: z.number().int().nonnegative(),
    beatsExtracted: z.number().int().nonnegative(),
    /** Null until a held-out evaluation exists. */
    evaluation: summaryEvaluationSchema.nullable(),
    headline: z.string().min(1),
    audiences: z.array(audienceCardSchema),
  })
  .refine((doc) => new Set(doc.audiences.map((card) => card.key)).size === doc.audiences.length, {
    message: "One card per audience",
    path: ["audiences"],
  });
export type SummaryDoc = z.infer<typeof summaryDocSchema>;

// channels/{id}/videos/{videoId} ---------------------------------------------

/** A beat as a video screen shows it: no transcript. */
export const videoBeatSchema = z
  .object({
    startS: seconds,
    endS: seconds,
    beatType: beatTypeSchema,
    visual: visualSchema,
    /** How much of the beat is a person to camera, 1 to 5. */
    talkingHeadShare: z.number().int().min(1).max(5),
    summary: z.string(),
  })
  .refine((beat) => beat.endS > beat.startS, { message: "A beat must end after it starts" });
export type VideoBeat = z.infer<typeof videoBeatSchema>;

/** One measured audience on a video screen. */
export const videoAudienceSchema = z
  .object({
    /** The measured curve; null when this audience's curve is incomplete. */
    actual: curveSchema.nullable(),
    /** The model's band; null when there is no model to predict it. */
    predicted: bandSchema.nullable(),
    model: modelStampSchema.nullable(),
  })
  .refine((audience) => (audience.predicted === null) === (audience.model === null), {
    message: "A prediction comes with its model, and a model with its prediction",
    path: ["model"],
  });
export type VideoAudience = z.infer<typeof videoAudienceSchema>;

/**
 * What a drop-off is attributed to: groups of model features under one human
 * label. `position` (the intro, the end screen, the curve's shape) is not
 * actionable but is shown so the rest is not overstated.
 */
export const ATTRIBUTION_GROUPS = {
  sponsor: "Sponsor segment",
  branded_intro: "Branded intro",
  call_to_action: "Call to action",
  tangent: "Tangent",
  recap: "Recap",
  payoff: "Waiting for the payoff",
  no_visual_change: "No visual change",
  visuals: "What's on screen",
  on_screen_text: "On-screen text",
  energy: "Delivery energy",
  pace: "Information pace",
  knowledge_gap: "Knowledge gap",
  long_beat: "Long single beat",
  music: "Foreground music",
  position: "Position in video",
} as const;
export const attributionGroupSchema = z.enum(
  Object.keys(ATTRIBUTION_GROUPS) as [keyof typeof ATTRIBUTION_GROUPS],
);
export type AttributionGroup = z.infer<typeof attributionGroupSchema>;

export const attributionSchema = z.object({
  group: attributionGroupSchema,
  label: z.string().min(1),
  /** Its part of the drop-off's extra loss, beyond the video's typical moment. */
  share: z.number().gt(0).max(1),
});
export type Attribution = z.infer<typeof attributionSchema>;

/** A drop-off: a stretch where an audience left fastest, and what the model links it to. */
export const dropSchema = z
  .object({
    audience: measuredAudienceSchema,
    startS: seconds,
    endS: seconds,
    binStart: bin,
    binEnd: bin,
    /** Share of the audience lost over the stretch, in percentage points. */
    actualLossPp: z.number().positive(),
    attributions: z.array(attributionSchema),
    /** The part the model does not explain. Always shipped. */
    residualShare: share,
    narrative: z.string().min(1),
  })
  .refine((drop) => drop.binEnd >= drop.binStart && drop.endS > drop.startS, {
    message: "A drop-off must end after it starts",
  })
  .refine(
    (drop) =>
      Math.abs(drop.attributions.reduce((sum, a) => sum + a.share, drop.residualShare) - 1) <=
      SUM_TOLERANCE,
    { message: "Attribution shares and the residual must sum to 1", path: ["residualShare"] },
  )
  .refine(
    (drop) => new Set(drop.attributions.map((a) => a.group)).size === drop.attributions.length,
    { message: "One share per group", path: ["attributions"] },
  );
export type Drop = z.infer<typeof dropSchema>;

/** At most this many drop-offs per audience and video. */
export const MAX_DROPS = 4;

/** `channels/{id}/videos/{videoId}`: one video's screen. */
export const videoDocSchema = z
  .object({
    channelId: channelIdSchema,
    videoId: videoIdSchema,
    runId: runIdSchema,
    generatedAt: isoDateTime,
    title: z.string(),
    publishedAt: isoDateTime,
    durationS: z.number().positive(),
    thumbnailUrl: z.url().nullable(),
    /** Lifetime totals over all viewers; null when YouTube has none yet. */
    stats: z
      .object({
        views: z.number().int().nonnegative(),
        /** Average view duration. */
        avdS: seconds,
        /** Average view percentage; counts rewatches, so it can pass 100. */
        avp: z.number().nonnegative(),
      })
      .nullable(),
    audiences: z.object({
      subscribed: videoAudienceSchema.optional(),
      unsubscribed: videoAudienceSchema.optional(),
    }),
    beats: z.array(videoBeatSchema),
    drops: z.array(dropSchema),
    /** The video was in the models' training data, so its curve is a fit, not a prediction. */
    inSample: z.boolean(),
  })
  .refine(
    (doc) =>
      measuredAudienceSchema.options.every(
        (audience) => doc.drops.filter((drop) => drop.audience === audience).length <= MAX_DROPS,
      ),
    { message: `At most ${MAX_DROPS} drop-offs per audience`, path: ["drops"] },
  );
export type VideoDoc = z.infer<typeof videoDocSchema>;

// channels/{id}/index/videos -------------------------------------------------

export const videoListItemSchema = z.object({
  videoId: videoIdSchema,
  title: z.string(),
  publishedAt: isoDateTime,
  durationS: z.number().positive(),
  thumbnailUrl: z.url().nullable(),
  avgViewPct: z.number().nonnegative().nullable(),
  /** The largest drop-off across the measured audiences; null when there is none. */
  biggestDrop: z
    .object({ audience: measuredAudienceSchema, atS: seconds, lossPp: z.number().positive() })
    .nullable(),
  inSample: z.boolean(),
});
export type VideoListItem = z.infer<typeof videoListItemSchema>;

/** `channels/{id}/index/videos`: every published video, so the list screen is one read. */
export const videoIndexDocSchema = z
  .object({
    channelId: channelIdSchema,
    runId: runIdSchema,
    generatedAt: isoDateTime,
    videos: z.array(videoListItemSchema),
  })
  .refine((doc) => new Set(doc.videos.map((video) => video.videoId)).size === doc.videos.length, {
    message: "Each video once",
    path: ["videos"],
  });
export type VideoIndexDoc = z.infer<typeof videoIndexDocSchema>;

// soundchecks/{id} (written in Phases 14 and 15) ------------------------------

/**
 * One suggested edit to a new cut, simulated on the cut's beats. `params` hold
 * the op's numbers (seconds, a target index); Phase 14 may tighten them.
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

export const soundcheckStatusSchema = z.enum(["queued", "running", "ready", "failed"]);
export type SoundcheckStatus = z.infer<typeof soundcheckStatusSchema>;

const soundcheckInputBase = {
  title: z.string(),
  /** The release scenario the creator picked; Phase 14 defines the values. */
  scenario: z.string().min(1).nullable(),
};

/** A new cut: an uploaded video in Cloud Storage, or a script. */
export const soundcheckInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("video"),
    uri: z.string().regex(/^gs:\/\/.+/),
    ...soundcheckInputBase,
  }),
  z.object({ kind: z.literal("script"), text: z.string().min(1), ...soundcheckInputBase }),
]);
export type SoundcheckInput = z.infer<typeof soundcheckInputSchema>;

/** `soundchecks/{id}`: a new cut, its predicted curves and suggested edits. */
export const soundcheckDocSchema = z.object({
  channelId: channelIdSchema,
  status: soundcheckStatusSchema,
  progress: z
    .object({
      stage: z.string().min(1),
      done: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
      etaS: seconds.optional(),
    })
    .optional(),
  /** A short reason, when `failed`. */
  error: z.string().optional(),
  input: soundcheckInputSchema,
  /** Unknown until the cut is read. */
  durationS: z.number().positive().nullable(),
  beats: z.array(videoBeatSchema).nullable(),
  prediction: z
    .object({
      audiences: z.object({
        subscribed: bandSchema.optional(),
        unsubscribed: bandSchema.optional(),
      }),
      avdS: percentilesSchema,
      avp: percentilesSchema,
    })
    .nullable(),
  /** Where the predicted average view percentage falls among the channel's videos, 0 to 100. */
  percentileVsChannel: z.number().min(0).max(100).nullable(),
  edits: z.array(editSchema),
  narrative: z.string().nullable(),
  /** A script has no picture, so its visual features were assumed. */
  visualAssumed: z.boolean(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type SoundcheckDoc = z.infer<typeof soundcheckDocSchema>;
