import {
  MIX_BUCKETS,
  buildBins,
  type FeatureVideo,
  type MixBucket,
  type TrafficMix,
} from "../features";
import {
  measuredAudienceSchema,
  type AudienceWeights,
  type MeasuredAudience,
  type ModelArtifact,
  type Percentiles,
  type Scenario,
} from "../schemas";
import { percentiles, sampleSurvival, survivalBand, type SurvivalBand } from "./runtime";

/**
 * Predicting a new cut (Phase 14): each audience's curve band and totals from
 * its model, under the creator's "Expected traffic" scenario, then both
 * audiences combined. Every number is a spread over the same seeded
 * coefficient draws, so a prediction is reproducible, and Phase 15 compares
 * edits on the same draws.
 */

/** A "Mostly …" scenario gives its traffic source, or subscribers, at least this share. */
export const SCENARIO_DOMINANT_SHARE = 0.7;
/** "Recent videos": the newest this many, for the scenario and the comparison. */
export const RECENT_VIDEOS = 20;
/** Coefficient draws per prediction, as publish uses. */
export const CUT_DRAWS = 200;

const MEASURED = measuredAudienceSchema.options;

/** How a cut's viewers are expected to arrive. */
export interface AudienceMix {
  /** Newcomers' shares by traffic source; the rest come from other sources. */
  mix: TrafficMix;
  /** Each audience's share of the views. */
  weights: AudienceWeights;
}

/** One recent video: its newcomer traffic mix, and its views by audience. */
export interface RecentVideo {
  mix: TrafficMix | null;
  views: { subscribed: number; unsubscribed: number };
}

/**
 * "Like my recent videos": the mean newcomer mix of recent videos (averaged as
 * the channel context averages mixes) and subscribers' share of their views.
 * Without mixes it uses `fallback`; without views, an even split.
 */
export function recentAudienceMix(
  videos: readonly RecentVideo[],
  fallback: TrafficMix,
): AudienceMix {
  const mixes = videos.flatMap((video) => (video.mix ? [video.mix] : []));
  const mean = (bucket: MixBucket) =>
    mixes.reduce((sum, mix) => sum + mix[bucket], 0) / mixes.length;
  const mix = mixes.length
    ? { search: mean("search"), suggested: mean("suggested"), browse: mean("browse") }
    : { ...fallback };
  const subscribed = videos.reduce((sum, video) => sum + video.views.subscribed, 0);
  const total = videos.reduce(
    (sum, video) => sum + video.views.subscribed + video.views.unsubscribed,
    0,
  );
  const share = total > 0 ? subscribed / total : 0.5;
  return { mix, weights: { subscribed: share, unsubscribed: 1 - share } };
}

/**
 * Gives `source` at least the dominant share of newcomer views, scaling the
 * other sources, and those outside the mix, down to fit.
 */
function dominate(mix: TrafficMix, source: MixBucket): TrafficMix {
  const current = mix[source];
  const target = Math.max(current, SCENARIO_DOMINANT_SHARE);
  const scale = current < 1 ? (1 - target) / (1 - current) : 0;
  const shares = MIX_BUCKETS.map(
    (bucket) => [bucket, bucket === source ? target : mix[bucket] * scale] as const,
  );
  return Object.fromEntries(shares) as Record<MixBucket, number>;
}

/** The audience mix a scenario assumes, starting from the channel's recent videos. */
export function scenarioAudienceMix(scenario: Scenario, recent: AudienceMix): AudienceMix {
  switch (scenario) {
    case "recent":
      return recent;
    case "search":
    case "suggested":
      return { mix: dominate(recent.mix, scenario), weights: recent.weights };
    case "subscribers": {
      const subscribed = Math.max(recent.weights.subscribed, SCENARIO_DOMINANT_SHARE);
      return { mix: recent.mix, weights: { subscribed, unsubscribed: 1 - subscribed } };
    }
  }
}

/**
 * The average view percentage of a survival curve: the area under the share
 * still watching, from everyone at 0 s to the end of the last bin, by
 * trapezoids, as a percentage of the video.
 */
export function averageViewPct(curve: ArrayLike<number>): number {
  let area = 0;
  let before = 1;
  for (let bin = 0; bin < curve.length; bin += 1) {
    const after = curve[bin] as number;
    area += (before + after) / 2;
    before = after;
  }
  return curve.length ? (100 * area) / curve.length : 0;
}

/**
 * Where `value` falls among `others`, 0 to 100: the share below it, ties
 * counting half ("better than 68% of your recent videos"). Null with nothing
 * to compare.
 */
export function percentileAmong(value: number, others: readonly number[]): number | null {
  if (!others.length) return null;
  const below = others.filter((other) => other < value).length;
  const ties = others.filter((other) => other === value).length;
  return (100 * (below + ties / 2)) / others.length;
}

/** An audience's model, and its held-out calibration factor (1 without one). */
export interface CutModel {
  artifact: ModelArtifact;
  inflation: number;
}

/** One audience's prediction for a cut. */
export interface CutAudience {
  band: SurvivalBand;
  /** Average view percentage, 0 to 100. */
  avp: Percentiles;
  /** Average view duration, in seconds. */
  avdS: Percentiles;
}

export interface CutPrediction {
  audiences: Partial<Record<MeasuredAudience, CutAudience>>;
  /** The scenario's weights, renormalized over the audiences with a model. */
  weights: AudienceWeights;
  /** Both audiences, weighted, draw by draw. */
  avp: Percentiles;
  avdS: Percentiles;
}

const seconds = (avp: Percentiles, durationS: number): Percentiles => ({
  p10: (avp.p10 / 100) * durationS,
  p50: (avp.p50 / 100) * durationS,
  p90: (avp.p90 / 100) * durationS,
});

/**
 * Predicts a cut for each audience that has a model. Newcomer rows carry the
 * scenario's traffic mix; features are measured against the channel numbers
 * each model was trained with. The combined numbers weight each draw's
 * average view percentages, so their spread is the spread of the mix.
 */
export function predictCut(
  video: FeatureVideo,
  durationS: number,
  models: Partial<Record<MeasuredAudience, CutModel>>,
  audienceMix: AudienceMix,
  { seed, draws = CUT_DRAWS }: { seed: number; draws?: number },
): CutPrediction {
  const present = MEASURED.filter((audience) => models[audience]);
  if (!present.length) throw new RangeError("A cut needs at least one audience's model");

  const audiences: Partial<Record<MeasuredAudience, CutAudience>> = {};
  const byDraw: Partial<Record<MeasuredAudience, Float64Array>> = {};
  for (const audience of present) {
    const { artifact, inflation } = models[audience] as CutModel;
    if (artifact.audience !== audience) {
      throw new RangeError(
        `Model ${artifact.runId} predicts ${artifact.audience}, not ${audience}`,
      );
    }
    if (!artifact.channelContext) {
      throw new RangeError(`Model ${artifact.runId} is not a channel's model`);
    }
    const frame = buildBins(
      video,
      durationS,
      artifact.channelContext,
      audience === "unsubscribed" ? audienceMix.mix : null,
    );
    const curves = sampleSurvival(artifact, frame, draws, seed, inflation);
    const avps = Float64Array.from(curves, averageViewPct);
    byDraw[audience] = avps;
    const avp = percentiles(avps);
    audiences[audience] = { band: survivalBand(curves), avp, avdS: seconds(avp, durationS) };
  }

  const total = present.reduce((sum, audience) => sum + audienceMix.weights[audience], 0);
  const weightOf = (audience: MeasuredAudience) =>
    !present.includes(audience)
      ? 0
      : total > 0
        ? audienceMix.weights[audience] / total
        : 1 / present.length;
  const weights = { subscribed: weightOf("subscribed"), unsubscribed: weightOf("unsubscribed") };
  const combined = Float64Array.from({ length: draws }, (_, draw) =>
    present.reduce(
      (sum, audience) =>
        sum + weights[audience] * ((byDraw[audience] as Float64Array)[draw] as number),
      0,
    ),
  );
  const avp = percentiles(combined);
  return { audiences, weights, avp, avdS: seconds(avp, durationS) };
}
