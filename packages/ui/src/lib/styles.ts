/**
 * Class strings from docs/plan/design-system.md shared by every interactive
 * element, so buttons and clickable cards lift and focus the same way.
 */

/** The hard offset shadow while lifting up-left 4px on hover; flat on press; still under reduced motion. */
export const LIFT = [
  "transition-[translate,box-shadow] duration-[120ms]",
  "hover:-translate-x-1 hover:-translate-y-1 hover:shadow-hard",
  "active:translate-x-0 active:translate-y-0 active:shadow-none",
  "motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0",
].join(" ");

/** A pink ring inside a black one, on keyboard focus only. */
export const FOCUS_RING =
  "focus-visible:outline-none focus-visible:shadow-[0_0_0_2px_var(--accent),0_0_0_4px_var(--ink)]";
