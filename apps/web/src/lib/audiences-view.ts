import type { AudienceCard } from "@soundcheck/core/schemas";

/** Why the screen's models are not usable, each reason once; empty when they all are. */
export function notUsableReasons(cards: readonly AudienceCard[]): string[] {
  return [
    ...new Set(
      cards.flatMap((card) => (card.model && !card.model.usable ? card.model.unusableReasons : [])),
    ),
  ];
}
