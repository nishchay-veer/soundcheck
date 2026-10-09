import { describe, expect, it } from "vitest";
import {
  beatTypeSchema,
  clockToSeconds,
  visualSchema,
  geminiResponseJsonSchema,
  geminiVideoBeatsSchema,
  toVideoBeats,
  videoFormatSchema,
  wordCount,
  wordsPerMinute,
  type GeminiVideoBeats,
} from "./beats";

const beat = (start: string, end: string, transcript = "") => ({
  start,
  end,
  beat_type: "explanation" as const,
  talking_head_share: 5,
  visual: "none" as const,
  cuts_per_min: 2,
  on_screen_text: false,
  music: "none" as const,
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  speaker_count: 1,
  transcript,
  summary: "He explains the plan.",
});

const answer: GeminiVideoBeats = {
  schema_version: "beats-v3",
  video_summary: "A short explainer.",
  format: "explainer",
  title_promise: "How the plan works.",
  target_level: 2,
  payoff_time: "1:05",
  beats: [
    beat("0:00", "0:30", "one two three four five six seven eight nine ten"),
    beat("0:30", "1:21"),
  ],
};

describe("clockToSeconds", () => {
  it.each([
    ["0:00", 0],
    ["1:21", 81],
    ["4:13", 253],
    ["75:30", 4_530],
    ["0:07.5", 7.5],
  ])("%s is %f s", (clock, seconds) => {
    expect(clockToSeconds(clock)).toBe(seconds);
  });

  it.each(["121", "1:60", "1:2", "-0:10", "1:21:00", ""])("rejects %j", (clock) => {
    expect(() => clockToSeconds(clock)).toThrow();
  });
});

describe("toVideoBeats", () => {
  it("converts clock times to seconds and computes words per minute", () => {
    const stored = toVideoBeats(answer);
    expect(stored.payoff_time_s).toBe(65);
    expect(stored.beats.map((b) => [b.start_s, b.end_s, b.words_per_minute])).toEqual([
      [0, 30, 20],
      [30, 81, 0],
    ]);
    expect(stored.beats[0]).not.toHaveProperty("start");
  });

  it("keeps a missing payoff as null", () => {
    expect(toVideoBeats({ ...answer, payoff_time: null }).payoff_time_s).toBeNull();
  });
});

describe("word limits", () => {
  it("counts words the way the limits do", () => {
    expect(wordCount("  one two\tthree\nfour ")).toBe(4);
    expect(wordCount("")).toBe(0);
    expect(wordsPerMinute("a b c", 30)).toBe(6);
    expect(wordsPerMinute("a b c", 0)).toBe(0);
  });

  it("rejects a beat summary over 20 words and a video summary over 60", () => {
    const long = (n: number) => Array.from({ length: n }, () => "word").join(" ");
    expect(geminiVideoBeatsSchema.safeParse({ ...answer, video_summary: long(60) }).success).toBe(
      true,
    );
    expect(geminiVideoBeatsSchema.safeParse({ ...answer, video_summary: long(61) }).success).toBe(
      false,
    );
    const [first, second] = answer.beats;
    const tooLong = { ...answer, beats: [{ ...first!, summary: long(21) }, second!] };
    expect(geminiVideoBeatsSchema.safeParse(tooLong).success).toBe(false);
  });

  it("rejects a scale outside 1 to 5 and an unknown label", () => {
    const [first, second] = answer.beats;
    expect(
      geminiVideoBeatsSchema.safeParse({ ...answer, beats: [{ ...first!, energy: 6 }, second!] })
        .success,
    ).toBe(false);
    expect(
      geminiVideoBeatsSchema.safeParse({
        ...answer,
        beats: [{ ...first!, beat_type: "intro" }, second!],
      }).success,
    ).toBe(false);
  });
});

describe("labels", () => {
  it("adds performance and other, and describes the picture with a share and a visual", () => {
    expect(videoFormatSchema.options).toContain("performance");
    expect(beatTypeSchema.options).toEqual(expect.arrayContaining(["performance", "other"]));
    expect(beatTypeSchema.options).toHaveLength(21);
    // Phase 06 iteration 3: framing became talking_head_share (1 to 5) and visual.
    expect(visualSchema.options).toEqual([
      "screen_recording",
      "b_roll",
      "graphics",
      "gameplay",
      "other",
      "none",
    ]);
  });
});

describe("geminiResponseJsonSchema", () => {
  it("is plain JSON Schema with clock-string timestamps and no $schema key", () => {
    const schema = geminiResponseJsonSchema() as {
      $schema?: unknown;
      properties: {
        beats: { items: { properties: Record<string, { type?: string; pattern?: string }> } };
      };
    };
    expect(schema.$schema).toBeUndefined();
    expect(schema.properties.beats.items.properties.start).toMatchObject({
      type: "string",
      pattern: expect.any(String),
    });
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});
