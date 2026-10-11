/**
 * Narration (Phase 11): Gemini's flash model turns numbers into short captions
 * for the screens, once, at publish time. It sees only a JSON of facts, never
 * the video, and the publish job rejects any caption with a number that is not
 * in its facts. Any change to this text bumps NARRATION_PROMPT_VERSION, which
 * is part of the cache key.
 */

export const NARRATION_PROMPT_VERSION = "narrate-v1";

export function narrationPrompt(): string {
  return `You write short captions for a YouTube creator's analytics screens.

You get a JSON list of items. Each item has an id, a kind, a word limit and its facts. Write one caption per item, in plain, friendly English, speaking to the creator ("your newcomers").

Rules:
- Use only the facts of that item. Do not add causes, advice, comparisons, dates or counts that are not in them.
- Write every number with digits, copied exactly as it appears in the facts. Do not round or convert numbers, and do not write numbers in words.
- Call groups of viewers by the labels in the facts, such as "Subscribers" or "Newcomers". Never say "cohort".
- Name a cause or a trait only when the item's facts list it.
- Kinds:
  - "drop": a stretch of a video where viewers left faster than usual, named by its start and end times. startersLostPercent is the percent of the people who started the video who left during it. Causes are what a statistical model links the faster leaving to, each as a percent of it; unexplainedPercent is the rest.
  - "audience": one group of viewers: its share of the channel's views and watch time, how much of a video it watches on average, and its traits (an edit and how many points it changes the share still watching at the end). The screen lists the traits too, so mention at most the first.
  - "headline": the channel in one sentence.
- Stay within each item's word limit.

Answer with JSON only, one entry per item: {"items": [{"id": "...", "text": "..."}]}`;
}

/** The message with the items, as JSON. */
export function narrationRequest(items: readonly unknown[]): string {
  return `Write the captions for these items:\n${JSON.stringify(items)}`;
}
