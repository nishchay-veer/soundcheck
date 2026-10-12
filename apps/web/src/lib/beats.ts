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

/** The groups beat blocks are colored by, everywhere a beat strip shows. */
export type BeatGroup = "opening" | "content" | "promotion" | "closing" | "tangent";

const GROUP_OF: Record<BeatType, BeatGroup> = {
  cold_open: "opening",
  hook: "opening",
  intro_branding: "opening",
  sponsor: "promotion",
  self_promo: "promotion",
  cta: "promotion",
  recap: "closing",
  outro: "closing",
  end_screen: "closing",
  tangent: "tangent",
  setup: "content",
  context: "content",
  explanation: "content",
  demonstration: "content",
  example: "content",
  story: "content",
  opinion: "content",
  performance: "content",
  payoff: "content",
  transition: "content",
  other: "content",
};

/** Each group's name and look (design system): tangents are white with a dashed outline. */
export const BEAT_GROUPS: Record<BeatGroup, { label: string; fill: string }> = {
  opening: { label: "Opening", fill: "bg-beat-opening" },
  content: { label: "Content", fill: "bg-surface" },
  promotion: { label: "Promotion", fill: "bg-beat-promotion" },
  closing: { label: "Closing", fill: "bg-beat-closing" },
  tangent: {
    label: "Tangent",
    fill: "bg-surface outline-2 outline-offset-[-5px] outline-dashed outline-ink",
  },
};

export const beatGroup = (type: BeatType): BeatGroup => GROUP_OF[type];

/** A beat block's fill classes, by its group. */
export function beatFill(type: BeatType): string {
  return BEAT_GROUPS[GROUP_OF[type]].fill;
}
