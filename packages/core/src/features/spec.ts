import {
  beatTypeSchema,
  videoFormatSchema,
  visualSchema,
  type FeatureKind,
  type FeatureSpecDocument,
  type FeatureSpecEntry,
} from "../schemas";
import { clampedKnots } from "./spline";

/**
 * The feature spec: the single source of truth for the columns of a feature
 * vector `x`, in order. Training rows and live predictions both build `x` from
 * it, and `feature_specs` stores it so Python can name the columns.
 *
 * FEATURE_VERSION is a hash of `FEATURE_SPEC_DOCUMENT` (checked by
 * spec.test.ts), so any change here changes the version. When a feature's
 * computation changes but its column does not, bump `FEATURE_REVISION`.
 *
 * Features are stored in the form the model uses them (`log1p_*`,
 * `has_open_loop`), because Python never computes a feature.
 */

export const FEATURE_REVISION = 1;

/** Bins per video: the retention curve's 100 points. */
export const BINS = 100;

/** A cubic B-spline of elapsed ratio; the first basis is dropped because the model has an intercept. */
export const POSITION_SPLINE = { degree: 3, interiorKnots: [0.25, 0.5, 0.75], droppedBasis: 0 };
export const POSITION_KNOTS = clampedKnots(POSITION_SPLINE.interiorKnots, POSITION_SPLINE.degree);
const POSITION_COLUMNS = POSITION_KNOTS.length - POSITION_SPLINE.degree - 2;

/**
 * A static talking head: a person to camera throughout with almost no cuts.
 * Stands in for the `talking_head_static` framing Phase 06 removed.
 */
export const STATIC_TALKING_HEAD = { minTalkingHeadShare: 5, maxCutsPerMin: 2 };

/** Traffic sources whose share within newcomers, centered at the channel mean, is a feature. */
export const MIX_BUCKETS = ["search", "suggested", "browse"] as const;
export type MixBucket = (typeof MIX_BUCKETS)[number];

/** The content features multiplied by each centered mix share (Phase 08). */
export const INTERACTION_FEATURES = [
  "beat_sponsor",
  "beat_intro_branding",
  "knowledge_gap",
  "log1p_static_run_s",
  "info_density",
  "before_payoff",
] as const;

const bounded = (
  name: string,
  kind: FeatureKind,
  clip: [number, number] | null,
): FeatureSpecEntry => ({ name, kind, clip });
/** Shares and indicators, both within 0 to 1. */
const unit = (name: string, kind: FeatureKind) => bounded(name, kind, [0, 1]);
/** Gemini's 1-to-5 ratings. */
const rating = (name: string, kind: FeatureKind) => bounded(name, kind, [1, 5]);

export const FEATURE_SPEC: readonly FeatureSpecEntry[] = [
  // Share of the bin covered by each beat type.
  ...beatTypeSchema.options.map((type) => unit(`beat_${type}`, "beat_type")),
  // Picture: share by visual, the presenter's share, editing and text.
  ...visualSchema.options.map((visual) => unit(`visual_${visual}`, "picture")),
  rating("talking_head_share", "picture"),
  unit("static_talking_head_share", "picture"),
  bounded("log1p_cuts_per_min", "picture", [0, 5]),
  unit("on_screen_text", "picture"),
  // Audio: music shares (none is the reference) and beats without speech.
  unit("music_bg", "audio"),
  unit("music_fg", "audio"),
  unit("silence", "audio"),
  // Delivery: overlap-weighted means.
  rating("energy", "delivery"),
  rating("assumed_knowledge", "delivery"),
  rating("info_density", "delivery"),
  bounded("speech_wpm", "delivery", [0, 400]),
  // Dynamics, at the bin midpoint or against the previous bin.
  bounded("log1p_secs_in_current_beat", "dynamics", [0, 7]),
  bounded("log1p_static_run_s", "dynamics", [0, 10]),
  bounded("energy_delta", "dynamics", [-4, 4]),
  // Narrative.
  unit("has_open_loop", "narrative"),
  unit("before_payoff", "narrative"),
  bounded("knowledge_gap", "narrative", [-4, 4]),
  // Position.
  unit("is_first_bin", "position"),
  bounded("log_bin_seconds", "position", [-5, 5]),
  ...Array.from({ length: POSITION_COLUMNS }, (_, i) => unit(`pos_b${i + 1}`, "spline")),
  // Video level.
  ...videoFormatSchema.options.map((format) => unit(`format_${format}`, "video")),
  rating("target_level", "video"),
  // Newcomer rows only; zero elsewhere.
  ...MIX_BUCKETS.map((bucket) => bounded(`mix_${bucket}`, "mix", [-1, 1])),
  ...INTERACTION_FEATURES.flatMap((feature) =>
    MIX_BUCKETS.map((bucket) => bounded(`ix_${feature}_${bucket}`, "interaction", null)),
  ),
];

export const FEATURE_NAMES: readonly string[] = FEATURE_SPEC.map((feature) => feature.name);

const INDEX = new Map(FEATURE_NAMES.map((name, index) => [name, index]));

/** The column of a feature in `x`. */
export function featureIndex(name: string): number {
  const index = INDEX.get(name);
  if (index === undefined) throw new RangeError(`Unknown feature: ${name}`);
  return index;
}

/** Everything that defines the columns and their computation; stored in `feature_specs`. */
export const FEATURE_SPEC_DOCUMENT: FeatureSpecDocument = {
  revision: FEATURE_REVISION,
  parameters: {
    bins: BINS,
    static_min_talking_head_share: STATIC_TALKING_HEAD.minTalkingHeadShare,
    static_max_cuts_per_min: STATIC_TALKING_HEAD.maxCutsPerMin,
  },
  position: {
    degree: POSITION_SPLINE.degree,
    interior_knots: [...POSITION_SPLINE.interiorKnots],
    dropped_basis: POSITION_SPLINE.droppedBasis,
  },
  interactions: { features: [...INTERACTION_FEATURES], mix: [...MIX_BUCKETS] },
  features: [...FEATURE_SPEC],
};

/**
 * Values that measure how people watched (rule 8): labels and weights, never
 * a column of `x`. Traffic-mix shares also come from Analytics, but they say
 * where newcomers came from, not how they watched: the spec uses them on
 * newcomer rows as a scenario chosen at prediction time (the estimated
 * audiences of Phase 08). They are the one exception.
 */
export const LEAKAGE = [
  "views",
  "engaged_views",
  "video_views",
  "n_at_risk",
  "estimated_minutes_watched",
  "average_view_duration",
  "average_view_duration_s",
  "average_view_percentage",
  "audience_watch_ratio",
  "relative_retention",
  "relative_retention_performance",
  "s_mono",
  "survival",
  "hazard",
  "rewatch_bumps",
  "rewatch_mass",
  "started_watching",
  "stopped_watching",
  "total_segment_impressions",
  "subscriber_count",
  "likes",
  "comments",
] as const;

/** Names that contain a leakage value as a whole `_`-separated part. */
export function leakedFeatures(names: readonly string[]): string[] {
  return names.filter((name) => LEAKAGE.some((value) => `_${name}_`.includes(`_${value}_`)));
}
