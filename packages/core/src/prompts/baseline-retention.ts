/**
 * The generic-LLM baseline (Phase 09, B1): Gemini watches a video and guesses
 * its retention curve for a typical YouTube audience, with no data from the
 * channel. It stands in for every rubric-based competitor. Any change to this
 * text bumps BASELINE_PROMPT_VERSION, which is part of the cache key.
 */

export const BASELINE_PROMPT_VERSION = "llm-retention-v1";

export function baselineRetentionPrompt(): string {
  return `You are an expert in YouTube audience retention.

You will watch a YouTube video. Predict its audience retention curve for a typical YouTube viewer, as YouTube Studio shows it: the share of the people who started the video who are still watching at each 5% of its length.

Give 20 values, at 5%, 10%, 15% and so on up to 100% of the video. Each value is between 0 and 1, and no value is higher than the one before it.

Judge only from the video itself: its opening, what happens on screen, its pacing, how long it is and how it ends. You know nothing about the channel or its audience. Answer with JSON only.`;
}

/** The instruction sent with the video. */
export function baselineRetentionRequest(durationLabel: string): string {
  return `Predict this video's audience retention. It lasts ${durationLabel}.`;
}
