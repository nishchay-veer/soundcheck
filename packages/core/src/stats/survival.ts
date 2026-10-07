/**
 * Survival and hazard labels from a measured retention curve.
 *
 * `audienceWatchRatio` is the share of viewers watching at each point of the
 * video. It can exceed 1 where people rewatch (Shorts loop), and it can rise
 * again later, so it is not a survival curve. `s_mono` makes it one: the
 * running minimum, starting from survival 1 at time zero. The hazard of bin i
 * is the share of viewers still watching at bin i - 1 who left by bin i.
 *
 * These are outcomes (labels for Phase 08), never model features (rule 8).
 */

/** Hazards are clipped below 1, so a bin where everyone leaves stays finite on a log scale. */
export const HAZARD_MAX = 0.999;
/** A rise larger than this between neighbouring points counts as a rewatch bump. */
export const REWATCH_BUMP = 0.02;
/** Ratios arrive with 4 decimals; this keeps a rise of exactly 0.02 from counting through float error. */
const EPSILON = 1e-9;

/** Running minimum of the watch ratio, capped at 1: survival can only fall. */
export function monotoneSurvival(watchRatio: readonly number[]): number[] {
  let survival = 1;
  return watchRatio.map((ratio) => (survival = Math.min(survival, ratio)));
}

/**
 * `hazard[i] = 1 - s[i] / s[i-1]`, with `s[-1] = 1`, clipped to [0, 0.999].
 * Once survival has reached 0 nobody is left to leave, so the hazard is 0.
 */
export function hazards(survival: readonly number[]): number[] {
  return survival.map((current, index) => {
    const previous = index === 0 ? 1 : (survival[index - 1] as number);
    if (previous <= 0) return 0;
    return Math.min(HAZARD_MAX, Math.max(0, 1 - current / previous));
  });
}

/** Survival rebuilt from hazards: the running product of `1 - hazard`. */
export function survivalFromHazards(hazard: readonly number[]): number[] {
  let survival = 1;
  return hazard.map((h) => (survival *= 1 - h));
}

/** Points that rise by more than `REWATCH_BUMP` over the previous point. */
export function rewatchBumps(watchRatio: readonly number[]): number {
  return watchRatio.filter(
    (ratio, index) =>
      index > 0 && ratio - (watchRatio[index - 1] as number) > REWATCH_BUMP + EPSILON,
  ).length;
}

/** How much the watch ratio sits above monotone survival, summed over the curve. */
export function rewatchMass(watchRatio: readonly number[], survival: readonly number[]): number {
  return watchRatio.reduce(
    (sum, ratio, index) => sum + Math.max(0, ratio - (survival[index] as number)),
    0,
  );
}

export interface SurvivalLabels {
  sMono: number[];
  hazard: number[];
  rewatchBumps: number;
  rewatchMass: number;
}

/** Everything derived from one curve's `audienceWatchRatio` series, in bin order. */
export function survivalLabels(watchRatio: readonly number[]): SurvivalLabels {
  for (const ratio of watchRatio) {
    if (!Number.isFinite(ratio) || ratio < 0) {
      throw new RangeError(`audienceWatchRatio must be a finite number >= 0, got ${ratio}`);
    }
  }
  const sMono = monotoneSurvival(watchRatio);
  return {
    sMono,
    hazard: hazards(sMono),
    rewatchBumps: rewatchBumps(watchRatio),
    rewatchMass: rewatchMass(watchRatio, sMono),
  };
}
