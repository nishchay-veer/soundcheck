import type { BeatType } from "@soundcheck/core/schemas";

/** What each beat type is called on screen. */
export const BEAT_LABELS: Record<BeatType, string> = {
  cold_open: "Cold open",
  hook: "Hook",
  intro_branding: "Branded intro",
  setup: "Setup",
  context: "Context",
  explanation: "Explanation",
  demonstration: "Demo",
  example: "Example",
  story: "Story",
  opinion: "Opinion",
  tangent: "Tangent",
  sponsor: "Sponsor",
  self_promo: "Self-promo",
  cta: "Call to action",
  recap: "Recap",
  payoff: "Payoff",
  transition: "Transition",
  outro: "Outro",
  end_screen: "End screen",
  performance: "Performance",
  other: "Other",
};

const OPENING: ReadonlySet<BeatType> = new Set(["cold_open", "hook", "intro_branding"]);
const PROMOTION: ReadonlySet<BeatType> = new Set(["sponsor", "self_promo", "cta"]);

/** A beat block's fill: openings and promotion have their own color; the rest are white. */
export function beatFill(type: BeatType): string {
  if (OPENING.has(type)) return "bg-beat-opening";
  if (PROMOTION.has(type)) return "bg-beat-promotion";
  return "bg-surface";
}
