import { measuredAudienceSchema, type AudienceWeights, type MeasuredAudience } from "../schemas";

const MEASURED = measuredAudienceSchema.options;

/**
 * Edits are recommended only on audiences with a usable model, and only when
 * those bring at least this share of the views the soundcheck expects.
 */
export const MIN_JUDGED_SHARE = 0.5;

export interface Judging {
  /** The audiences whose models judge the edits. */
  audiences: MeasuredAudience[];
  /** Their share of the expected views, summing to 1; the others' zero. */
  weights: AudienceWeights;
}

/**
 * Which audiences a cut's edits are judged on: those whose model is usable,
 * weighted by their share of the expected views, when together they bring at
 * least half of them. On a channel whose subscriber model learned from too few
 * videos, its newcomers still get recommendations. Null when the usable
 * audiences bring too few views (or there are none): edits are then listed on
 * every audience and none is recommended. `usable` has an entry for each
 * audience with a model.
 */
export function judging(
  weights: AudienceWeights,
  usable: Partial<Record<MeasuredAudience, boolean>>,
): Judging | null {
  const present = MEASURED.filter((audience) => usable[audience] !== undefined);
  const judged = present.filter((audience) => usable[audience]);
  if (!judged.length) return null;
  const total = present.reduce((sum, audience) => sum + weights[audience], 0);
  // With no view shares at all, each audience counts the same.
  const weight = (audience: MeasuredAudience) => (total > 0 ? weights[audience] : 1);
  const judgedShare = judged.reduce((sum, audience) => sum + weight(audience), 0);
  const presentShare = total > 0 ? total : present.length;
  if (judgedShare / presentShare < MIN_JUDGED_SHARE) return null;
  const share = (audience: MeasuredAudience) =>
    judged.includes(audience) ? weight(audience) / judgedShare : 0;
  return {
    audiences: judged,
    weights: { subscribed: share("subscribed"), unsubscribed: share("unsubscribed") },
  };
}
