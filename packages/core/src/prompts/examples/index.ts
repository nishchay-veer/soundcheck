import { geminiVideoBeatsSchema } from "../../schemas/beats";
import type { BeatExample } from "../extract-beats";
import applicationVideo from "./application-video.json" with { type: "json" };
import musicCover from "./music-cover.json" with { type: "json" };

/**
 * Annotations of real videos, drafted by Gemini and then corrected by a person
 * who watched them (`reviewed: true`), shown to Gemini as examples of
 * granularity and labelling.
 */
export const BEAT_EXAMPLE_FILES = {
  "application-video": applicationVideo,
  "music-cover": musicCover,
};

export const BEAT_EXAMPLES: readonly BeatExample[] = Object.values(BEAT_EXAMPLE_FILES).map(
  (example) => ({
    description: example.description,
    duration: example.duration,
    annotation: geminiVideoBeatsSchema.parse(example.annotation),
  }),
);
