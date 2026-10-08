import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { formatClock, validateBeats } from "./validate-beats";

const clock = (seconds: number) => formatClock(seconds);
const beat = (start: number, end: number, overrides: Record<string, unknown> = {}) => ({
  start: clock(start),
  end: clock(end),
  beat_type: "explanation",
  framing: "talking_head",
  cuts_per_min: 0,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  speaker_count: 1,
  transcript: "",
  summary: "A beat.",
  ...overrides,
});
const answer = (beats: unknown[], overrides: Record<string, unknown> = {}) => ({
  schema_version: "beats-v2",
  video_summary: "A video.",
  format: "explainer",
  title_promise: "Something.",
  target_level: 2,
  payoff_time: null,
  beats,
  ...overrides,
});
const errorsOf = (result: ReturnType<typeof validateBeats>) => (result.ok ? [] : result.errors);

describe("validateBeats", () => {
  it("accepts contiguous beats that cover the video", () => {
    const result = validateBeats(answer([beat(0, 40), beat(40, 88)]), 88);
    expect(result).toMatchObject({ ok: true, coverage: 1, fixes: [] });
  });

  it("sorts beats by start", () => {
    const result = validateBeats(answer([beat(40, 88), beat(0, 40)]), 88);
    expect(result.ok && result.beats.beats.map((b) => b.start_s)).toEqual([0, 40]);
  });

  it("closes gaps and overlaps under 2 s by moving the earlier beat's end", () => {
    const result = validateBeats(answer([beat(1, 30), beat(31, 60), beat(59, 87)]), 88);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.beats.beats.map((b) => [b.start_s, b.end_s])).toEqual([
      [0, 31],
      [31, 59],
      [59, 88],
    ]);
    expect(result.fixes).toHaveLength(4);
  });

  it("clamps the last beat to the duration", () => {
    const result = validateBeats(answer([beat(0, 40), beat(40, 95)]), 88);
    expect(result.ok && result.beats.beats[1]?.end_s).toBe(88);
  });

  it("keeps a larger gap while coverage stays at 95% or more", () => {
    const result = validateBeats(answer([beat(0, 50), beat(54, 100)]), 100);
    expect(result).toMatchObject({ ok: true, coverage: 0.96 });
  });

  it("rejects coverage under 95%, naming the gap for Gemini", () => {
    expect(errorsOf(validateBeats(answer([beat(0, 312), beat(350, 600)]), 600))).toEqual([
      "Your output covers 94% of the video; it has a gap from 5:12 to 5:50. Beats must cover the whole video, from 0:00 to 10:00.",
    ]);
    expect(errorsOf(validateBeats(answer([beat(0, 60)]), 100))[0]).toMatch(
      /covers 60%.*from 1:00 to 1:40/,
    );
  });

  it("rejects beats under 1 s or over 600 s", () => {
    const tiny = { ...beat(10, 10), end: "0:10.5" };
    const after = { ...beat(11, 60), start: "0:10.5" };
    expect(errorsOf(validateBeats(answer([beat(0, 10), tiny, after]), 60))[0]).toMatch(
      /lasts 0\.5 s/,
    );
    expect(errorsOf(validateBeats(answer([beat(0, 700)]), 700))[0]).toMatch(
      /lasts 700 s; split it/,
    );
  });

  it("rejects overlaps of 2 s or more, beats after the end, and inverted beats", () => {
    expect(errorsOf(validateBeats(answer([beat(0, 50), beat(40, 88)]), 88))[0]).toMatch(
      /overlap from 0:40 to 0:50/,
    );
    expect(errorsOf(validateBeats(answer([beat(0, 88), beat(90, 95)]), 88))[0]).toMatch(
      /starts at 1:30, after the video ends at 1:28/,
    );
    expect(errorsOf(validateBeats(answer([beat(0, 30), beat(50, 40)]), 88))[0]).toMatch(
      /ends at 0:40, before it starts/,
    );
  });

  it("rejects a payoff after the end", () => {
    expect(errorsOf(validateBeats(answer([beat(0, 88)], { payoff_time: "2:00" }), 88))[0]).toMatch(
      /payoff time 2:00/,
    );
  });

  it("rejects output that fails the schema, saying where", () => {
    const errors = errorsOf(validateBeats(answer([beat(0, 88, { energy: 9 })]), 88));
    expect(errors[0]).toMatch(/^Your output does not match the schema at beats\.0\.energy/);
    expect(errorsOf(validateBeats("not json", 88))[0]).toMatch(/at the top level/);
  });

  it("recomputes words per minute after moving a boundary", () => {
    const words = Array.from({ length: 30 }, () => "word").join(" ");
    const result = validateBeats(answer([beat(0, 29, { transcript: words }), beat(30, 60)]), 60);
    expect(result.ok && result.beats.beats[0]?.words_per_minute).toBe(60);
  });

  it("accepts any contiguous covering of the video unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 600 }), { minLength: 1, maxLength: 30 }),
        (lengths) => {
          let cursor = 0;
          const beats = lengths.map((length) => beat(cursor, (cursor += length)));
          const result = validateBeats(answer(beats), cursor);
          expect(result.ok).toBe(true);
          if (!result.ok) return;
          expect(result.coverage).toBe(1);
          expect(result.fixes).toEqual([]);
          result.beats.beats.forEach((b, i) => {
            if (i > 0) expect(b.start_s).toBe(result.beats.beats[i - 1]?.end_s);
          });
        },
      ),
    );
  });
});

describe("formatClock", () => {
  it.each([
    [0, "0:00"],
    [81, "1:21"],
    [4_530, "75:30"],
    [59.6, "1:00"],
  ])("%f s is %s", (seconds, text) => {
    expect(formatClock(seconds)).toBe(text);
  });
});
