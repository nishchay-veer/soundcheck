import {
  buildBins,
  featureIndex,
  tileBeats,
  type FeatureBeat,
  type FeatureVideo,
  type TrafficMix,
} from "../features";
import {
  measuredAudienceSchema,
  type AudienceWeights,
  type MeasuredAudience,
  type Percentiles,
} from "../schemas";
import { averageViewPct, type CutModel } from "./cut";
import { drawCoefficients, percentiles, survivalBand, type SurvivalBand } from "./runtime";

/**
 * Simulating edits to a cut (Phase 15). A cut is its beats in seconds; an
 * edit removes a beat, trims it, or moves it. After the edits the beats are
 * re-timed end to end, the bins rebuilt with the same featurizer, and each
 * audience predicted on the same coefficient draws as the unedited cut
 * (common random numbers), so the difference between two cuts is measured
 * draw by draw and its interval is tight and honest.
 */

const MEASURED = measuredAudienceSchema.options;

/** One edit, naming beats by their index in the cut as extracted. */
export type CutEdit =
  | { op: "remove"; beat: number }
  /** Keeps the first `keep` of the beat (0.5 cuts its second half). */
  | { op: "trim"; beat: number; keep: number }
  /** Moves the beat to just before beat `to`, or to the end when `to` is the beat count. */
  | { op: "move"; beat: number; to: number };

/** A beat of the edited cut, with where it came from. */
export interface EditedSpan {
  /** The beat's index in the cut as extracted. */
  beat: number;
  startS: number;
  endS: number;
  /** Where the beat started and ended in the cut as extracted. */
  fromS: number;
  toS: number;
  edit: CutEdit["op"] | null;
}

export interface EditedCut {
  video: FeatureVideo;
  durationS: number;
  spans: EditedSpan[];
}

/**
 * Applies edits to a cut. Beats are first stretched to tile the cut exactly,
 * as the featurizer does, so applying no edits changes nothing and removing a
 * beat shortens the cut by exactly its span. Each beat takes at most one edit.
 *
 * The payoff time follows its beat: moved with it, or, when its beat is cut,
 * pushed to the end, because the promise is then never delivered and viewers
 * wait to the end. Open questions follow the beat order by themselves.
 */
export function applyEdits(
  video: FeatureVideo,
  durationS: number,
  edits: readonly CutEdit[],
): EditedCut {
  const count = video.beats.length;
  const edited = new Map<number, CutEdit>();
  for (const edit of edits) {
    if (!Number.isInteger(edit.beat) || edit.beat < 0 || edit.beat >= count) {
      throw new RangeError(`No beat ${edit.beat} in a cut of ${count}`);
    }
    if (edited.has(edit.beat)) throw new RangeError(`Beat ${edit.beat} has two edits`);
    if (edit.op === "trim" && !(edit.keep > 0 && edit.keep < 1)) {
      throw new RangeError(`A trim keeps between 0 and 1 of its beat, not ${edit.keep}`);
    }
    if (
      edit.op === "move" &&
      (!Number.isInteger(edit.to) || edit.to < 0 || edit.to > count || edit.to === edit.beat)
    ) {
      throw new RangeError(`Beat ${edit.beat} cannot move before ${edit.to}`);
    }
    edited.set(edit.beat, edit);
  }

  // The cut as the featurizer tiles it, each tile knowing its beat's index.
  const tiles = tileBeats(video.beats, durationS).map((segment) => ({
    beat: video.beats.indexOf(segment.beat),
    from: segment.start,
    to: segment.end,
    source: segment.beat,
  }));

  // Order: every kept beat in place, then each moved beat before its target
  // (or the next beat after it that is kept), or at the end.
  const kept = tiles.filter((tile) => edited.get(tile.beat)?.op !== "remove");
  const order = kept.filter((tile) => edited.get(tile.beat)?.op !== "move");
  for (const tile of kept) {
    const edit = edited.get(tile.beat);
    if (edit?.op !== "move") continue;
    // Placed against the beats that stay put, never another moved beat.
    const at = order.findIndex(
      (other) => edited.get(other.beat)?.op !== "move" && other.beat >= edit.to,
    );
    order.splice(at === -1 ? order.length : at, 0, tile);
  }

  let clock = 0;
  const spans: EditedSpan[] = [];
  const beats: FeatureBeat[] = [];
  for (const tile of order) {
    const edit = edited.get(tile.beat) ?? null;
    const length = (tile.to - tile.from) * (edit?.op === "trim" ? edit.keep : 1);
    spans.push({
      beat: tile.beat,
      startS: clock,
      endS: clock + length,
      fromS: tile.from,
      toS: tile.to,
      edit: edit?.op ?? null,
    });
    beats.push({ ...tile.source, start_s: clock, end_s: clock + length });
    clock += length;
  }
  if (!beats.length) throw new RangeError("Every beat was cut");

  return {
    video: { ...video, beats, payoff_time_s: mapTime(video.payoff_time_s, spans, clock) },
    durationS: clock,
    spans,
  };
}

/**
 * A time in the cut as extracted, in the edited cut: within its beat's new
 * span (the end of what a trim kept), or the end of the edited cut when its
 * beat was cut or it lies at the very end (see `applyEdits` for the payoff).
 */
function mapTime(t: number | null, spans: readonly EditedSpan[], end: number): number | null {
  if (t === null) return null;
  const span = spans.find((s) => t >= s.fromS && t < s.toS);
  if (!span) return end;
  return Math.min(span.endS, span.startS + (t - span.fromS));
}

/** One audience's draws, folded so a bin's logit is `intercept + Σ slope · x` on raw features. */
interface AudienceDraws {
  columns: Int32Array;
  /** Per draw: alpha minus Σ beta · mean / sd. */
  intercepts: Float64Array;
  /** Draw by draw, then feature by feature: beta / sd. */
  slopes: Float64Array;
  channel: NonNullable<CutModel["artifact"]["channelContext"]>;
}

/** The same draws for every cut of a soundcheck: common random numbers. */
export interface CutSampler {
  draws: number;
  audiences: Partial<Record<MeasuredAudience, AudienceDraws>>;
}

/**
 * Draws each audience's coefficients once, from the soundcheck's seed, and
 * folds the standardization into them, so a cut costs one pass over its
 * non-zero features per draw. The draws are `predictCut`'s, so an unedited cut
 * gives Phase 14's prediction.
 */
export function cutSampler(
  models: Partial<Record<MeasuredAudience, CutModel>>,
  { seed, draws = 200 }: { seed: number; draws?: number },
): CutSampler {
  const audiences: CutSampler["audiences"] = {};
  for (const audience of MEASURED) {
    const model = models[audience];
    if (!model) continue;
    const { artifact, inflation } = model;
    if (artifact.audience !== audience) {
      throw new RangeError(
        `Model ${artifact.runId} predicts ${artifact.audience}, not ${audience}`,
      );
    }
    if (!artifact.channelContext) {
      throw new RangeError(`Model ${artifact.runId} is not a channel's model`);
    }
    const width = artifact.featureNames.length;
    const intercepts = new Float64Array(draws);
    const slopes = new Float64Array(draws * width);
    drawCoefficients(artifact, draws, seed, inflation).forEach((theta, draw) => {
      let intercept = theta[0] as number;
      for (let j = 0; j < width; j += 1) {
        const slope = (theta[j + 1] as number) / (artifact.sd[j] as number);
        slopes[draw * width + j] = slope;
        intercept -= slope * (artifact.mean[j] as number);
      }
      intercepts[draw] = intercept;
    });
    audiences[audience] = {
      columns: Int32Array.from(artifact.featureNames, (name) => featureIndex(name)),
      intercepts,
      slopes,
      channel: artifact.channelContext,
    };
  }
  if (!Object.keys(audiences).length) {
    throw new RangeError("A cut needs at least one audience's model");
  }
  return { draws, audiences };
}

export interface SimulatedCut {
  durationS: number;
  /** Each audience's average view percentage, draw by draw. */
  avp: Partial<Record<MeasuredAudience, Float64Array>>;
  /** Each audience's band, when asked for. */
  bands: Partial<Record<MeasuredAudience, SurvivalBand>>;
}

/** Predicts a cut on the sampler's draws: newcomer rows carry the scenario's mix. */
export function simulateCut(
  sampler: CutSampler,
  cut: { video: FeatureVideo; durationS: number },
  mix: TrafficMix,
  { bands = false }: { bands?: boolean } = {},
): SimulatedCut {
  const result: SimulatedCut = { durationS: cut.durationS, avp: {}, bands: {} };
  for (const audience of MEASURED) {
    const draws = sampler.audiences[audience];
    if (!draws) continue;
    const frame = buildBins(
      cut.video,
      cut.durationS,
      draws.channel,
      audience === "unsubscribed" ? mix : null,
    );
    const width = draws.columns.length;
    // Each bin's non-zero features: most columns are zero in any one bin.
    const rows = Array.from({ length: frame.rows }, (_, bin) => {
      const at: number[] = [];
      const values: number[] = [];
      draws.columns.forEach((column, j) => {
        const value = frame.values[column * frame.rows + bin] as number;
        if (value !== 0) {
          at.push(j);
          values.push(value);
        }
      });
      return { at, values };
    });
    const avps = new Float64Array(sampler.draws);
    const curves: Float64Array[] = [];
    for (let draw = 0; draw < sampler.draws; draw += 1) {
      const base = draw * width;
      const curve = new Float64Array(frame.rows);
      let still = 1;
      rows.forEach(({ at, values }, bin) => {
        let eta = draws.intercepts[draw] as number;
        for (let k = 0; k < at.length; k += 1) {
          eta += (draws.slopes[base + (at[k] as number)] as number) * (values[k] as number);
        }
        still *= 1 - 1 / (1 + Math.exp(-eta));
        curve[bin] = still;
      });
      avps[draw] = averageViewPct(curve);
      if (bands) curves.push(curve);
    }
    result.avp[audience] = avps;
    if (bands) result.bands[audience] = survivalBand(curves);
  }
  return result;
}

/** What an edit is judged on: seconds watched (the default), or the share of the cut. */
export type Objective = "avd" | "avp";

/** The scenario's weights over the audiences with draws, summing to 1. */
export function presentWeights(
  sampler: CutSampler,
  weights: AudienceWeights,
): Record<MeasuredAudience, number> {
  const present = MEASURED.filter((audience) => sampler.audiences[audience]);
  const total = present.reduce((sum, audience) => sum + weights[audience], 0);
  const share = (audience: MeasuredAudience) =>
    !present.includes(audience) ? 0 : total > 0 ? weights[audience] / total : 1 / present.length;
  return { subscribed: share("subscribed"), unsubscribed: share("unsubscribed") };
}

/** One draw's objective for one audience: percent of the cut, or seconds. */
const value = (
  cut: SimulatedCut,
  audience: MeasuredAudience,
  draw: number,
  objective: Objective,
) => {
  const avp = (cut.avp[audience] as Float64Array)[draw] as number;
  return objective === "avp" ? avp : (avp / 100) * cut.durationS;
};

export interface CutComparison {
  /** The change in the weighted objective. */
  delta: Percentiles;
  /** The change for each audience on its own. */
  byAudience: Partial<Record<MeasuredAudience, Percentiles>>;
  /** The audience whose weighted median change is largest in size. */
  driver: MeasuredAudience;
}

/** How much `candidate` changes the objective against `baseline`, draw by draw. */
export function compareCuts(
  sampler: CutSampler,
  baseline: SimulatedCut,
  candidate: SimulatedCut,
  weights: AudienceWeights,
  objective: Objective = "avd",
): CutComparison {
  const share = presentWeights(sampler, weights);
  const present = MEASURED.filter((audience) => sampler.audiences[audience]);
  const byAudience: CutComparison["byAudience"] = {};
  const combined = new Float64Array(sampler.draws);
  let driver = present[0] as MeasuredAudience;
  let largest = -1;
  for (const audience of present) {
    const deltas = Float64Array.from(
      { length: sampler.draws },
      (_, draw) =>
        value(candidate, audience, draw, objective) - value(baseline, audience, draw, objective),
    );
    deltas.forEach(
      (delta, draw) => (combined[draw] = (combined[draw] as number) + share[audience] * delta),
    );
    const spread = percentiles(deltas);
    byAudience[audience] = spread;
    if (Math.abs(share[audience] * spread.p50) > largest) {
      largest = Math.abs(share[audience] * spread.p50);
      driver = audience;
    }
  }
  return { delta: percentiles(combined), byAudience, driver };
}
