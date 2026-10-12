import type { AudienceCard, Effect } from "@soundcheck/core/schemas";

/** Why the screen's models are not usable, each reason once; empty when they all are. */
export function notUsableReasons(cards: readonly AudienceCard[]): string[] {
  return [
    ...new Set(
      cards.flatMap((card) => (card.model && !card.model.usable ? card.model.unusableReasons : [])),
    ),
  ];
}

/** The half-width of an effect sheet's scale: its largest effect or interval end, at least 1 point. */
export function effectDomain(effects: readonly Effect[]): number {
  return Math.max(
    1,
    ...effects.flatMap((effect) =>
      effect.ci ? [Math.abs(effect.ci[0]), Math.abs(effect.ci[1])] : [],
    ),
  );
}
