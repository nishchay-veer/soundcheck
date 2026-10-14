/**
 * Chapters (Phase 15): Gemini's flash model groups a soundcheck's beats into
 * chapters and titles them, once, in the job. It sees only the beats' types,
 * times and one-line summaries, never the video. Any change to this text
 * bumps CHAPTERS_PROMPT_VERSION.
 */

export const CHAPTERS_PROMPT_VERSION = "chapters-v1";

/** The most words a chapter title may have. */
export const CHAPTER_TITLE_WORDS = 5;

export function chaptersPrompt(): string {
  return `You title the chapters of a YouTube video for its description.

You get the video's beats in order, each with its index, its start time, its length in seconds, its type and a one-line summary.

Rules:
- Group consecutive beats into 3 to 8 chapters, in order, each about one thing. Chapter 1 starts at beat 0; every beat belongs to exactly one chapter.
- Prefer chapters of at least 30 seconds. Keep a sponsor read, a call to action or an end screen inside a neighbouring chapter rather than giving it its own.
- Title each chapter in at most ${CHAPTER_TITLE_WORDS} words, in sentence case, saying what the viewer gets there. No numbering, emoji, quotation marks or clickbait.
- Use only what the summaries say.

Answer with JSON only: {"chapters": [{"first_beat": 0, "title": "..."}]}, with first_beat increasing.`;
}

/** The message with the beats, as JSON. */
export function chaptersRequest(video: unknown): string {
  return `Title the chapters of this video:\n${JSON.stringify(video)}`;
}
