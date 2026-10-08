import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Beat, VideoBeats } from "../schemas/beats";
import { extractionWindows, stitchWindows, toVideoTime } from "./stitch";

const beat = (
  start_s: number,
  end_s: number,
  beat_type: Beat["beat_type"] = "explanation",
  transcript = "",
): Beat => ({
  start_s,
  end_s,
  beat_type,
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
  transcript,
  summary: "A beat.",
  words_per_minute: 0,
});
const video = (beats: Beat[], overrides: Partial<VideoBeats> = {}): VideoBeats => ({
  schema_version: "beats-v2",
  video_summary: "A long video.",
  format: "explainer",
  title_promise: "Something.",
  target_level: 2,
  payoff_time_s: null,
  beats,
  ...overrides,
});

describe("extractionWindows", () => {
  it("extracts videos up to 40 minutes in one pass", () => {
    expect(extractionWindows(88)).toEqual([{ index: 0, startS: 0, endS: 88 }]);
    expect(extractionWindows(2_400)).toEqual([{ index: 0, startS: 0, endS: 2_400 }]);
  });

  it("splits longer videos into 20-minute windows overlapping by 30 s", () => {
    expect(extractionWindows(2_460)).toEqual([
      { index: 0, startS: 0, endS: 1_200 },
      { index: 1, startS: 1_170, endS: 2_370 },
      { index: 2, startS: 2_340, endS: 2_460 },
    ]);
  });

  it("covers the whole video with 30 s overlaps and windows of at most 20 minutes", () => {
    fc.assert(
      fc.property(fc.integer({ min: 2_401, max: 6 * 3_600 }), (duration) => {
        const windows = extractionWindows(duration);
        expect(windows[0]?.startS).toBe(0);
        expect(windows.at(-1)?.endS).toBe(duration);
        windows.forEach((window, i) => {
          expect(window.endS - window.startS).toBeLessThanOrEqual(1_200);
          if (i > 0) expect(windows[i - 1]!.endS - window.startS).toBe(30);
        });
      }),
    );
  });
});

describe("toVideoTime", () => {
  it("shifts beats and the payoff by the window start", () => {
    const shifted = toVideoTime(
      { index: 1, startS: 1_170, endS: 2_370 },
      video([beat(0, 45)], { payoff_time_s: 10 }),
    );
    expect(shifted.beats.map((b) => [b.start_s, b.end_s])).toEqual([[1_170, 1_215]]);
    expect(shifted.payoff_time_s).toBe(1_180);
  });
});

describe("stitchWindows", () => {
  const first = { index: 0, startS: 0, endS: 1_200 };
  const second = { index: 1, startS: 1_170, endS: 2_370 };

  it("drops later beats inside the overlap and merges a crossing beat of the same type", () => {
    const stitched = stitchWindows([
      { window: first, beats: video([beat(0, 900), beat(900, 1_200, "demonstration", "a b")]) },
      {
        window: second,
        beats: video([
          beat(1_170, 1_190, "transition"),
          beat(1_190, 1_500, "demonstration", "c d"),
          beat(1_500, 2_370),
        ]),
      },
    ]);
    expect(stitched.beats.map((b) => [b.start_s, b.end_s, b.beat_type])).toEqual([
      [0, 900, "explanation"],
      [900, 1_500, "demonstration"],
      [1_500, 2_370, "explanation"],
    ]);
    expect(stitched.beats[1]?.transcript).toBe("a b c d");
  });

  it("does not merge when the joined beat would exceed 600 s", () => {
    const stitched = stitchWindows([
      { window: first, beats: video([beat(0, 800), beat(800, 1_200)]) },
      { window: second, beats: video([beat(1_170, 1_570), beat(1_570, 2_370)]) },
    ]);
    expect(stitched.beats.map((b) => [b.start_s, b.end_s])).toEqual([
      [0, 800],
      [800, 1_200],
      [1_200, 1_570],
      [1_570, 2_370],
    ]);
  });

  it("starts a crossing beat of another type where the earlier window ends", () => {
    const stitched = stitchWindows([
      { window: first, beats: video([beat(0, 1_200)]) },
      { window: second, beats: video([beat(1_170, 1_400, "story"), beat(1_400, 2_370)]) },
    ]);
    expect(stitched.beats.map((b) => [b.start_s, b.end_s, b.beat_type])).toEqual([
      [0, 1_200, "explanation"],
      [1_200, 1_400, "story"],
      [1_400, 2_370, "explanation"],
    ]);
  });

  it("keeps the first window's video fields and the first payoff any window reports", () => {
    const stitched = stitchWindows([
      { window: first, beats: video([beat(0, 1_200)], { format: "tutorial" }) },
      {
        window: second,
        beats: video([beat(1_170, 2_370)], { format: "vlog", payoff_time_s: 2_000 }),
      },
    ]);
    expect(stitched.format).toBe("tutorial");
    expect(stitched.payoff_time_s).toBe(2_000);
  });

  it("returns a single window unchanged", () => {
    const only = video([beat(0, 88)]);
    expect(stitchWindows([{ window: { index: 0, startS: 0, endS: 88 }, beats: only }])).toEqual(
      only,
    );
  });
});
