import { z } from "zod";

/**
 * Beats: a video split into contiguous spans that each have one purpose, with
 * typed features per span. Gemini returns the wire form (`geminiVideoBeatsSchema`),
 * whose timestamps are "M:SS" strings because plain seconds came back garbled
 * in the Phase 05 probe ("1:21" as 121). `toVideoBeats` converts it to the
 * stored form in seconds. Any change to these enums or fields must bump
 * EXTRACTION_VERSION (and the literal below), which invalidates the cache.
 *
 * `performance` (formats and beat types) and the `other` beat type are
 * additions to the spec's lists, for music and other performed content.
 */

export const BEATS_SCHEMA_VERSION = "beats-v1";

export const videoFormatSchema = z.enum([
  "tutorial",
  "explainer",
  "review",
  "vlog",
  "commentary",
  "story",
  "interview",
  "listicle",
  "challenge",
  "news",
  "performance",
  "other",
]);
export type VideoFormat = z.infer<typeof videoFormatSchema>;

export const beatTypeSchema = z.enum([
  "cold_open",
  "hook",
  "intro_branding",
  "setup",
  "context",
  "explanation",
  "demonstration",
  "example",
  "story",
  "opinion",
  "tangent",
  "sponsor",
  "self_promo",
  "cta",
  "recap",
  "payoff",
  "transition",
  "outro",
  "end_screen",
  "performance",
  "other",
]);
export type BeatType = z.infer<typeof beatTypeSchema>;

export const framingSchema = z.enum([
  "talking_head_static",
  "talking_head_moving",
  "screen_recording",
  "b_roll",
  "graphics",
  "slides",
  "gameplay",
  "mixed",
  "other",
]);
export type Framing = z.infer<typeof framingSchema>;

export const musicSchema = z.enum(["none", "background", "foreground"]);

/** Words in a text, as the 20- and 60-word limits count them. */
export function wordCount(text: string): number {
  return text.trim() === "" ? 0 : text.trim().split(/\s+/).length;
}

const words = (max: number, description: string) =>
  z
    .string()
    .describe(`${description} At most ${max} words.`)
    .refine((text) => wordCount(text) <= max, { message: `At most ${max} words` });

const scale = (description: string) => z.number().int().min(1).max(5).describe(description);

/** "M:SS" from the start of the video; minutes may exceed 59. */
export const clockSchema = z
  .string()
  .regex(/^\d+:[0-5]\d(\.\d+)?$/)
  .describe('Time from the start of the video as "M:SS", for example "4:13"');

/** Seconds in an "M:SS" clock time. */
export function clockToSeconds(clock: string): number {
  const [minutes, seconds] = clockSchema.parse(clock).split(":");
  return Number(minutes) * 60 + Number(seconds);
}

/** One beat as Gemini returns it. */
export const geminiBeatSchema = z.object({
  start: clockSchema,
  end: clockSchema,
  beat_type: beatTypeSchema.describe("The single purpose of this span"),
  framing: framingSchema.describe("What the picture mostly shows"),
  cuts_per_min: z.number().int().min(0).describe("Visible cuts per minute in this span"),
  on_screen_text: z.boolean().describe("Whether text is overlaid on screen for a noticeable time"),
  music: musicSchema,
  energy: scale("Delivery energy, 1 to 5"),
  assumed_knowledge: scale("Expertise the span assumes, 1 to 5"),
  info_density: scale("New information per minute, 1 to 5"),
  opens_loop: z
    .string()
    .nullable()
    .describe("A question or promise raised here and answered later; null if none"),
  closes_loop: z.boolean().describe("Whether this span answers an earlier open question"),
  speaker_count: z.number().int().min(0).describe("People speaking in this span"),
  transcript: z.string().describe("Verbatim speech in this span; empty if none"),
  summary: words(20, "What happens in this span."),
});

/** A whole video as Gemini returns it; `responseJsonSchema` is built from this. */
export const geminiVideoBeatsSchema = z.object({
  schema_version: z.enum([BEATS_SCHEMA_VERSION]),
  video_summary: words(60, "What the video is about."),
  format: videoFormatSchema,
  title_promise: z.string().describe("What the title and opening promise the viewer"),
  target_level: scale("Expertise the video assumes of its audience, 1 to 5"),
  payoff_time: clockSchema
    .nullable()
    .describe("When the main promise is delivered; null if it never is"),
  beats: z.array(geminiBeatSchema).min(1),
});
export type GeminiVideoBeats = z.infer<typeof geminiVideoBeatsSchema>;

/**
 * The JSON Schema sent as `responseJsonSchema`. The `$schema` key is dropped;
 * word limits are refinements, so they live in the descriptions and are
 * enforced when the answer is parsed.
 */
export function geminiResponseJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(geminiVideoBeatsSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** One stored beat: times in seconds, plus speech rate computed in code. */
export const beatSchema = geminiBeatSchema.omit({ start: true, end: true }).extend({
  start_s: z.number().nonnegative(),
  end_s: z.number().positive(),
  /** Words in the transcript per minute of the beat; computed, never asked of Gemini. */
  words_per_minute: z.number().nonnegative(),
});
export type Beat = z.infer<typeof beatSchema>;

/** A stored, validated extraction. */
export const videoBeatsSchema = geminiVideoBeatsSchema
  .omit({ payoff_time: true, beats: true })
  .extend({
    payoff_time_s: z.number().nonnegative().nullable(),
    beats: z.array(beatSchema).min(1),
  });
export type VideoBeats = z.infer<typeof videoBeatsSchema>;

/** Words per minute of a span's transcript. */
export function wordsPerMinute(transcript: string, durationS: number): number {
  return durationS > 0 ? (wordCount(transcript) * 60) / durationS : 0;
}

/**
 * Converts Gemini's answer to the stored form: clock times to seconds and
 * words per minute from each transcript. Ordering, gaps and coverage are the
 * validator's job (`gemini/validate-beats.ts`).
 */
export function toVideoBeats(answer: GeminiVideoBeats): VideoBeats {
  const { payoff_time, beats, ...video } = answer;
  return videoBeatsSchema.parse({
    ...video,
    payoff_time_s: payoff_time === null ? null : clockToSeconds(payoff_time),
    beats: beats.map(({ start, end, ...beat }) => {
      const start_s = clockToSeconds(start);
      const end_s = clockToSeconds(end);
      return {
        ...beat,
        start_s,
        end_s,
        words_per_minute: wordsPerMinute(beat.transcript, end_s - start_s),
      };
    }),
  });
}
