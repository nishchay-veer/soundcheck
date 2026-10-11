// Versioned Gemini prompts and their few-shot examples.
import { BEAT_EXAMPLES } from "./examples";
import { extractBeatsPrompt } from "./extract-beats";

export * from "./baseline-retention";
export * from "./extract-beats";
export * from "./narration";
export { BEAT_EXAMPLES, BEAT_EXAMPLE_FILES } from "./examples";

/** The beat-extraction system instruction with the reviewed examples. */
export const beatExtractionPrompt = (): string => extractBeatsPrompt(BEAT_EXAMPLES);
