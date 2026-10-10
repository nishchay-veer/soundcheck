import { FEATURE_SPEC, INTERACTION_FEATURES, MIX_BUCKETS } from "../features/spec";
import type { TrainingAudience } from "../schemas";
import { FEATURE_VERSION, MODEL_VERSION } from "../versions";

/**
 * What the hazard model is fitted on (Phase 08) and how it is evaluated
 * (Phase 09), exported for Python by `gen:schemas` so both languages use one
 * list. Changing a column list or a fitting setting bumps MODEL_VERSION;
 * the evaluation split does not change a model.
 */

/** Where in the video a bin is; the spline columns are not penalized. */
export const POSITION_FEATURES = [
  "is_first_bin",
  "log_bin_seconds",
  ...FEATURE_SPEC.filter((feature) => feature.kind === "spline").map((feature) => feature.name),
];

/** The starting content features: about 20, chosen for strength, not completeness. */
export const CONTENT_FEATURES = [
  "beat_sponsor",
  "beat_intro_branding",
  "beat_cta",
  "beat_tangent",
  "static_talking_head_share",
  "log1p_static_run_s",
  "log1p_cuts_per_min",
  "on_screen_text",
  "energy",
  "info_density",
  "knowledge_gap",
  "has_open_loop",
  "before_payoff",
  "log1p_secs_in_current_beat",
  "speech_wpm",
  "music_fg",
  "visual_b_roll",
  "visual_screen_recording",
  "beat_recap",
  "beat_payoff",
];

/** Newcomer rows only: the centered traffic mix and its interactions with content. */
export const NEWCOMER_FEATURES = [
  ...MIX_BUCKETS.map((bucket) => `mix_${bucket}`),
  ...INTERACTION_FEATURES.flatMap((feature) =>
    MIX_BUCKETS.map((bucket) => `ix_${feature}_${bucket}`),
  ),
];

/** The columns of `x` a model for this audience is fitted on, in order. */
export function modelColumns(audience: TrainingAudience): string[] {
  return [
    ...POSITION_FEATURES,
    ...CONTENT_FEATURES,
    ...(audience === "unsubscribed" ? NEWCOMER_FEATURES : []),
  ];
}

/** Coefficients the penalty leaves alone (the intercept is never penalized either). */
export const UNPENALIZED_FEATURES = FEATURE_SPEC.filter((feature) => feature.kind === "spline").map(
  (feature) => feature.name,
);

/** The penalty strengths cross-validation chooses from. */
export const MODEL_LAMBDAS = [0.1, 1, 3, 10, 30, 100];
/** The pooled model's penalty: small, so it describes the channels rather than shrinks them. */
export const POOLED_LAMBDA = 0.1;
/** Cross-validation folds, grouped by video; fewer when a channel has fewer videos. */
export const CV_FOLDS = 5;

/**
 * How Phase 09 splits a channel's videos: the newest `testShare` (at least
 * `minTestVideos`) of those at least `minAgeDays` old are the test set. A
 * channel that cannot also keep MIN_TRAIN_VIDEOS for training is evaluated in
 * check mode, each video held out in turn.
 */
export const EVALUATION_SPLIT = { minTestVideos: 6, testShare: 0.2, minAgeDays: 14 };

/** The settings the fitter reads, as `services/modeling/schemas/model-config.json`. */
export const MODEL_CONFIG = {
  modelVersion: MODEL_VERSION,
  featureVersion: FEATURE_VERSION,
  columns: {
    all: modelColumns("all"),
    subscribed: modelColumns("subscribed"),
    unsubscribed: modelColumns("unsubscribed"),
  },
  unpenalized: UNPENALIZED_FEATURES,
  lambdas: MODEL_LAMBDAS,
  pooledLambda: POOLED_LAMBDA,
  folds: CV_FOLDS,
  evaluation: EVALUATION_SPLIT,
};
