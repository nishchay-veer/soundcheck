import type { AudienceKey } from "@soundcheck/core/schemas";

/** Each audience's fixed color (design system), as a fill class. */
export const AUDIENCE_FILL: Record<AudienceKey, string> = {
  subscribed: "bg-aud-subscribers",
  unsubscribed: "bg-aud-newcomers",
  search: "bg-aud-search",
  suggested: "bg-aud-suggested",
  browse: "bg-aud-browse",
};

/** The same colors as CSS values, for SVG strokes and fills. */
export const AUDIENCE_COLOR: Record<AudienceKey, string> = {
  subscribed: "var(--aud-subscribers)",
  unsubscribed: "var(--aud-newcomers)",
  search: "var(--aud-search)",
  suggested: "var(--aud-suggested)",
  browse: "var(--aud-browse)",
};
