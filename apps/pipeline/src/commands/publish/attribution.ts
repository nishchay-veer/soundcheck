import type { FeatureFrame } from "@soundcheck/core/features";
import { groupOf, logitTerms } from "@soundcheck/core/model";
import {
  ATTRIBUTION_GROUPS,
  type Attribution,
  type AttributionGroup,
  type ModelArtifact,
} from "@soundcheck/core/schemas";

/**
 * Drop-off attribution (Phase 11): which content features the model links a
 * drop-off to.
 *
 * - The reference is the video's typical moment: the bin (2 to 100) with its
 *   median measured hazard.
 * - The drop-off's excess is how much higher its measured hazard is, on the
 *   logit scale, averaged over its bins.
 * - Each feature pushes the logit by beta (x - x_ref) / sd (the runtime's
 *   `logitTerms`); features are summed into human groups, and position terms
 *   (the spline, the first bin, time into the video) form the "position in
 *   video" group.
 * - Only groups that push the hazard up explain the drop-off. Each share is
 *   that push over the excess; when the pushes add up to more than the
 *   excess, they are scaled down to fit. The residual is the rest, so the
 *   shares and the residual sum to 1, and it always ships.
 * - Groups under 1% are left out and their part counted in the residual.
 */

/** Shares below this are left in the residual. */
export const MIN_SHARE = 0.01;
/** Hazards are clamped this far from 0 and 1 before taking logits. */
const EPSILON = 1e-4;

const logit = (h: number) => {
  const p = Math.min(1 - EPSILON, Math.max(EPSILON, h));
  return Math.log(p / (1 - p));
};

export interface DropAttribution {
  attributions: Attribution[];
  residualShare: number;
}

/** The bin index (from 0) of the median measured hazard among bins 2 to 100. */
export function referenceBin(hazard: ArrayLike<number>): number {
  const bins = Array.from({ length: hazard.length - 1 }, (_, k) => k + 1).sort(
    (a, b) => (hazard[a] as number) - (hazard[b] as number) || a - b,
  );
  return bins[Math.floor((bins.length - 1) / 2)] as number;
}

/**
 * What the model links a drop-off over bins `binStart` to `binEnd` (from 1)
 * to, given the video's frame and its measured hazards for the same audience.
 */
export function attributeDrop(
  artifact: Pick<ModelArtifact, "featureNames" | "mean" | "sd" | "beta">,
  frame: FeatureFrame,
  hazard: ArrayLike<number>,
  { binStart, binEnd }: { binStart: number; binEnd: number },
): DropAttribution {
  const reference = referenceBin(hazard);
  const bins = Array.from({ length: binEnd - binStart + 1 }, (_, k) => binStart - 1 + k);
  const mean = (values: (bin: number) => number) =>
    bins.reduce((sum, bin) => sum + values(bin), 0) / bins.length;

  const excess = mean((bin) => logit(hazard[bin] as number)) - logit(hazard[reference] as number);
  const terms = logitTerms(artifact, frame);
  const pushes = new Map<AttributionGroup, number>();
  artifact.featureNames.forEach((feature, j) => {
    const group = groupOf(feature);
    if (!group) return;
    const push =
      mean((bin) => (terms[bin] as Float64Array)[j] as number) -
      ((terms[reference] as Float64Array)[j] as number);
    pushes.set(group, (pushes.get(group) ?? 0) + push);
  });

  const up = [...pushes].filter(([, push]) => push > 0);
  const total = up.reduce((sum, [, push]) => sum + push, 0);
  if (!(excess > 0) || total <= 0) return { attributions: [], residualShare: 1 };

  const attributions = up
    .map(([group, push]) => ({
      group,
      label: ATTRIBUTION_GROUPS[group],
      share: push / Math.max(total, excess),
    }))
    .filter((attribution) => attribution.share >= MIN_SHARE)
    .sort((a, b) => b.share - a.share || a.group.localeCompare(b.group));
  const explained = attributions.reduce((sum, attribution) => sum + attribution.share, 0);
  return { attributions, residualShare: Math.max(0, 1 - explained) };
}
