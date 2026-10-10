import {
  buildBins,
  MIX_BUCKETS,
  type FeatureBeat,
  type FeatureVideo,
  type MixBucket,
  type TrafficMix,
} from "../features";
import type { ModelArtifact } from "../schemas";
import { drawCoefficients, predictHazard, survival } from "./runtime";

/**
 * Traits (Phase 08): the model turned into readable statements by
 * simulation, not by reading coefficients. A scenario edits a typical video's
 * beats (for example, 30 seconds of sponsor at 30% elapsed), the Phase 07
 * featurizer rebuilds the frame, and the trait is the change in the share
 * still watching at the end of the video, in percentage points. Its interval
 * comes from coefficient draws applied to both the original and the edited
 * video, so it reflects the edit alone. Associations in past videos, not causes.
 */

/** The interval reported with each trait: the 5th to 95th percentile of the draws. */
export const TRAIT_INTERVAL = [0.05, 0.95] as const;

export interface Scenario {
  /** The model columns the edit is about; the trait is only measured if the model has one. */
  features: readonly string[];
  condition: string;
  edit: (video: FeatureVideo, durationS: number) => FeatureVideo;
}

export interface Trait {
  feature: string;
  condition: string;
  /** False when none of the scenario's columns varied in training, so the model never learned it. */
  measured: boolean;
  /** Change in the share still watching at the end, in percentage points; null when not measured. */
  deltaPp: number | null;
  ciLow: number | null;
  ciHigh: number | null;
}

/**
 * The video with `patch` applied between `start` and `end` seconds: beats
 * that cross an edge are split, so only the span changes.
 */
export function overlay(
  video: FeatureVideo,
  start: number,
  end: number,
  patch: Partial<FeatureBeat>,
): FeatureVideo {
  const beats = video.beats.flatMap((beat) => {
    if (beat.end_s <= start || beat.start_s >= end) return [beat];
    const parts: FeatureBeat[] = [];
    if (beat.start_s < start) parts.push({ ...beat, end_s: start });
    parts.push({
      ...beat,
      ...patch,
      start_s: Math.max(beat.start_s, start),
      end_s: Math.min(beat.end_s, end),
    });
    if (beat.end_s > end) parts.push({ ...beat, start_s: end });
    return parts;
  });
  return { ...video, beats };
}

/** Every beat changed by `change`. */
const everywhere =
  (change: (beat: FeatureBeat) => Partial<FeatureBeat>) => (video: FeatureVideo) => ({
    ...video,
    beats: video.beats.map((beat) => ({ ...beat, ...change(beat) })),
  });

/** `seconds` from `fraction` of the way in, kept inside the video. */
const span =
  (fraction: number, seconds: number, patch: Partial<FeatureBeat>) =>
  (video: FeatureVideo, durationS: number) => {
    const start = Math.min(fraction * durationS, Math.max(0, durationS - seconds));
    return overlay(video, start, Math.min(durationS, start + seconds), patch);
  };

const up = (value: number) => Math.min(5, value + 1);

/** One scenario per starting content feature (two for the static talking head). */
export const SCENARIOS: readonly Scenario[] = [
  {
    features: ["beat_sponsor"],
    condition: "a 30 s sponsor read at 30%",
    edit: span(0.3, 30, { beat_type: "sponsor" }),
  },
  {
    features: ["beat_intro_branding"],
    condition: "a 15 s branded intro at the start",
    edit: span(0, 15, { beat_type: "intro_branding" }),
  },
  {
    features: ["beat_cta"],
    condition: "a 15 s call to action at 50%",
    edit: span(0.5, 15, { beat_type: "cta" }),
  },
  {
    features: ["beat_tangent"],
    condition: "a 45 s tangent at 50%",
    edit: span(0.5, 45, { beat_type: "tangent" }),
  },
  {
    features: ["beat_recap"],
    condition: "a 30 s recap at 70%",
    edit: span(0.7, 30, { beat_type: "recap" }),
  },
  {
    features: ["beat_payoff"],
    condition: "a 20 s payoff beat at 75%",
    edit: span(0.75, 20, { beat_type: "payoff" }),
  },
  {
    features: ["static_talking_head_share", "log1p_static_run_s"],
    condition: "60 s of static talking head at 40%",
    edit: span(0.4, 60, { talking_head_share: 5, visual: "none", cuts_per_min: 0 }),
  },
  {
    features: ["visual_b_roll"],
    condition: "60 s of b-roll at 40%",
    edit: span(0.4, 60, { visual: "b_roll", talking_head_share: 1 }),
  },
  {
    features: ["visual_screen_recording"],
    condition: "60 s of screen recording at 40%",
    edit: span(0.4, 60, { visual: "screen_recording", talking_head_share: 1 }),
  },
  {
    features: ["music_fg"],
    condition: "30 s of foreground music at 50%",
    edit: span(0.5, 30, { music: "foreground" }),
  },
  {
    features: ["log1p_cuts_per_min"],
    condition: "twice as many cuts throughout",
    edit: everywhere((beat) => ({ cuts_per_min: beat.cuts_per_min * 2 + 1 })),
  },
  {
    features: ["on_screen_text"],
    condition: "on-screen text throughout",
    edit: everywhere(() => ({ on_screen_text: true })),
  },
  {
    features: ["energy"],
    condition: "one point more energy throughout",
    edit: everywhere((beat) => ({ energy: up(beat.energy) })),
  },
  {
    features: ["info_density"],
    condition: "one point denser throughout",
    edit: everywhere((beat) => ({ info_density: up(beat.info_density) })),
  },
  {
    features: ["knowledge_gap"],
    condition: "one point more assumed knowledge throughout",
    edit: everywhere((beat) => ({ assumed_knowledge: up(beat.assumed_knowledge) })),
  },
  {
    features: ["speech_wpm"],
    condition: "speech 20% faster throughout",
    edit: everywhere((beat) => ({ words_per_minute: beat.words_per_minute * 1.2 })),
  },
  {
    features: ["log1p_secs_in_current_beat"],
    condition: "beats half as long",
    edit: (video) => ({
      ...video,
      beats: video.beats.flatMap((beat) => {
        const middle = (beat.start_s + beat.end_s) / 2;
        return [
          { ...beat, end_s: middle },
          { ...beat, start_s: middle, opens_loop: null, closes_loop: false },
        ];
      }),
    }),
  },
  {
    features: ["has_open_loop"],
    condition: "a question opened at the start and answered at 75%",
    edit: (video, durationS) =>
      overlay(
        overlay(video, 0, Math.min(10, durationS / 10), { opens_loop: "Will it work?" }),
        0.75 * durationS,
        Math.min(durationS, 0.75 * durationS + 10),
        { closes_loop: true },
      ),
  },
  {
    features: ["before_payoff"],
    condition: "the title's promise delivered at 25%",
    edit: (video, durationS) => ({ ...video, payoff_time_s: 0.25 * durationS }),
  },
];

/** The q-quantile of values, interpolating between neighbours. */
function quantile(values: readonly number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const below = Math.floor(position);
  const low = sorted[below] as number;
  return (
    low + (position - below) * ((sorted[Math.min(below + 1, sorted.length - 1)] as number) - low)
  );
}

/** Share still watching at the end of the video, for coefficients theta = (alpha, beta...). */
function finalSurvival(
  artifact: ModelArtifact,
  theta: Float64Array,
  frame: ReturnType<typeof buildBins>,
) {
  const curve = survival(
    predictHazard(
      { ...artifact, alpha: theta[0] as number, beta: Array.from(theta.subarray(1)) },
      frame,
    ),
  );
  return curve[curve.length - 1] as number;
}

/**
 * Each scenario's change in the share still watching at the end of `video`,
 * for the audience the artifact models. `mix` is the newcomer traffic mix
 * (null for subscribers and all viewers); the channel's mean mix describes a
 * typical newcomer.
 */
export function traits(
  artifact: ModelArtifact,
  video: FeatureVideo,
  durationS: number,
  mix: TrafficMix | null,
  {
    draws = 200,
    seed = 1,
    scenarios = SCENARIOS,
  }: { draws?: number; seed?: number; scenarios?: readonly Scenario[] } = {},
): Trait[] {
  const context = artifact.channelContext;
  if (!context) throw new RangeError("Traits need a channel's model, not the pooled one");
  const frameOf = (v: FeatureVideo) => buildBins(v, durationS, context, mix);
  const base = frameOf(video);
  const samples = drawCoefficients(artifact, draws, seed);
  const estimate = Float64Array.from([artifact.alpha, ...artifact.beta]);
  const baseEstimate = finalSurvival(artifact, estimate, base);
  const baseSamples = samples.map((theta) => finalSurvival(artifact, theta, base));

  return scenarios.map((scenario) => {
    const feature = scenario.features[0] ?? "";
    const measured = scenario.features.some((name) => artifact.featureNames.includes(name));
    if (!measured) {
      return {
        feature,
        condition: scenario.condition,
        measured,
        deltaPp: null,
        ciLow: null,
        ciHigh: null,
      };
    }
    const edited = frameOf(scenario.edit(video, durationS));
    const deltas = samples.map(
      (theta, k) => 100 * (finalSurvival(artifact, theta, edited) - (baseSamples[k] as number)),
    );
    return {
      feature,
      condition: scenario.condition,
      measured,
      deltaPp: 100 * (finalSurvival(artifact, estimate, edited) - baseEstimate),
      ciLow: quantile(deltas, TRAIT_INTERVAL[0]),
      ciHigh: quantile(deltas, TRAIT_INTERVAL[1]),
    };
  });
}

/** An estimated audience is shown only when its share varies enough across enough videos. */
export const ESTIMATED_AUDIENCE_RULE = { minShareSd: 0.08, minVideos: 30 };

export interface EstimatedAudience {
  source: MixBucket;
  shown: boolean;
  /** Why it is hidden; empty when shown. */
  reasons: string[];
  /** The traits with this source's newcomers (the mix set fully to it). */
  traits: Trait[];
}

const excludesZero = (trait: Trait) =>
  trait.ciLow !== null && trait.ciHigh !== null && (trait.ciLow > 0 || trait.ciHigh < 0);

/**
 * Search, suggested and browse newcomers, from the newcomer model with the mix
 * set fully to each source. One is shown only if its share has a standard
 * deviation of at least 0.08 across at least 30 training videos and at least
 * one trait's interval excludes zero; otherwise it is hidden, not guessed.
 */
export function estimatedAudiences(
  newcomers: ModelArtifact,
  video: FeatureVideo,
  durationS: number,
  options: { draws?: number; seed?: number; scenarios?: readonly Scenario[] } = {},
): EstimatedAudience[] {
  if (newcomers.audience !== "unsubscribed") {
    throw new RangeError(
      `Estimated audiences come from the newcomer model, not ${newcomers.audience}`,
    );
  }
  const videos = newcomers.trainVideoIds.length;
  return MIX_BUCKETS.map((source) => {
    const column = newcomers.featureNames.indexOf(`mix_${source}`);
    const sd = column === -1 ? 0 : (newcomers.sd[column] as number);
    const mix = Object.fromEntries(MIX_BUCKETS.map((b) => [b, b === source ? 1 : 0])) as TrafficMix;
    const sourceTraits = traits(newcomers, video, durationS, mix, options);
    const reasons: string[] = [];
    if (sd < ESTIMATED_AUDIENCE_RULE.minShareSd) {
      reasons.push(
        `its share varies by ${sd.toFixed(2)} across videos; at least ${ESTIMATED_AUDIENCE_RULE.minShareSd} is needed`,
      );
    }
    if (videos < ESTIMATED_AUDIENCE_RULE.minVideos) {
      reasons.push(
        `trained on ${videos} videos; at least ${ESTIMATED_AUDIENCE_RULE.minVideos} are needed`,
      );
    }
    if (!sourceTraits.some(excludesZero)) reasons.push("no trait's interval excludes zero");
    return { source, shown: reasons.length === 0, reasons, traits: sourceTraits };
  });
}
