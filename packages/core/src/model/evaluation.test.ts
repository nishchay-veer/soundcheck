import { describe, expect, it } from "vitest";
import { evaluationTestVideos, heldOutMinimum } from "./evaluation";

const day = (offset: number) =>
  new Date(Date.UTC(2026, 9, 10) - offset * 86_400_000).toISOString().slice(0, 10);

describe("evaluationTestVideos", () => {
  // The same cases as services/modeling/tests/test_evaluate.py, so both languages agree.
  it("holds out the newest fifth of settled videos and leaves young ones out", () => {
    const videos = Array.from({ length: 50 }, (_, i) => ({
      videoId: `v${String(i).padStart(2, "0")}`,
      published: day(500 - 10 * i),
    }));
    const split = evaluationTestVideos(videos, day(0), 30);
    expect(split.mode).toBe("holdout");
    expect(split.test).toEqual(Array.from({ length: 10 }, (_, i) => `v${39 + i}`));
  });

  it("tests every video of a small channel in check mode", () => {
    const videos = [0, 1, 2].map((i) => ({ videoId: `v${i}`, published: day(100 + i) }));
    expect(evaluationTestVideos(videos, day(0), 30)).toEqual({
      mode: "check",
      test: ["v2", "v1", "v0"],
    });
    expect(() => evaluationTestVideos(videos.slice(0, 1), day(0), 30)).toThrow(RangeError);
  });

  it("names the fewest settled videos a held-out test needs", () => {
    expect(heldOutMinimum(20)).toBe(26);
    expect(heldOutMinimum(30)).toBe(38);
    for (const minTrain of [2, 10, 20, 30, 45]) {
      const settled = (count: number) =>
        Array.from({ length: count }, (_, i) => ({ videoId: `v${i}`, published: day(30 + i) }));
      const least = heldOutMinimum(minTrain);
      expect(evaluationTestVideos(settled(least), day(0), minTrain).mode).toBe("holdout");
      expect(evaluationTestVideos(settled(least - 1), day(0), minTrain).mode).toBe("check");
    }
  });
});
