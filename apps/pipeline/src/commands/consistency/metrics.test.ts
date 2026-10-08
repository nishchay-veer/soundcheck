import type { VideoBeats } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import {
  averageMetrics,
  gateChecks,
  pairMetrics,
  runsIdentical,
  topConfusions,
  type RunExtraction,
} from "./metrics";

type BeatSpec = [start: number, end: number, type: string, framing?: string, energy?: number];

function run(
  videoId: string,
  durationS: number,
  specs: BeatSpec[],
  payoff: number | null = null,
): RunExtraction {
  return {
    videoId,
    durationS,
    beats: {
      schema_version: "beats-v2",
      video_summary: "",
      format: "explainer",
      title_promise: "",
      target_level: 2,
      payoff_time_s: payoff,
      beats: specs.map(([start_s, end_s, beat_type, framing = "talking_head", energy = 3]) => ({
        start_s,
        end_s,
        beat_type,
        framing,
        cuts_per_min: 0,
        on_screen_text: false,
        music: "none",
        energy,
        assumed_knowledge: energy,
        info_density: energy,
        opens_loop: null,
        closes_loop: false,
        speaker_count: 1,
        transcript: "",
        summary: "",
        words_per_minute: 0,
      })),
    } as VideoBeats,
  };
}

const base: BeatSpec[] = [
  [0, 10, "hook", "talking_head", 4],
  [10, 40, "setup", "screen_recording", 3],
  [40, 90, "demonstration", "screen_recording", 2],
  [90, 100, "outro", "talking_head", 3],
];

describe("pairMetrics", () => {
  it("is perfect for identical runs", () => {
    const metrics = pairMetrics([run("a", 100, base, 50)], [run("a", 100, base, 50)]);
    expect(metrics).toMatchObject({
      boundaryF1: 1,
      beatTypeKappa: 1,
      framingKappa: 1,
      ordinal: { energy: 1, assumed_knowledge: 1, info_density: 1 },
      payoff: { meanAbsS: 0, compared: 1, oneMissing: 0 },
      seconds: 100,
      videos: 1,
    });
  });

  it("counts boundaries within 3 s as matching", () => {
    const shifted: BeatSpec[] = [
      [0, 12, "hook", "talking_head", 4],
      [12, 38, "setup", "screen_recording", 3],
      [38, 95, "demonstration", "screen_recording", 2],
      [95, 100, "outro", "talking_head", 3],
    ];
    const metrics = pairMetrics([run("a", 100, base)], [run("a", 100, shifted)]);
    // 10/12 and 40/38 match; 90/95 do not: 2 of 3 on each side.
    expect(metrics.boundaryF1).toBeCloseTo(4 / 6, 12);
    expect(metrics.beatTypeKappa).toBeLessThan(1);
  });

  it("pools videos, so one video with a single label throughout keeps kappa defined", () => {
    const music: BeatSpec[] = [[0, 30, "performance", "talking_head", 2]];
    const metrics = pairMetrics(
      [run("talk", 100, base), run("song", 30, music)],
      [run("talk", 100, base), run("song", 30, music)],
    );
    expect(metrics.beatTypeKappa).toBe(1);
    expect(metrics.seconds).toBe(130);
  });

  it("compares only videos both runs have, and reports payoff disagreement", () => {
    const metrics = pairMetrics(
      [run("a", 100, base, 50), run("b", 100, base, 20)],
      [run("a", 100, base, 56), run("c", 100, base, null)],
    );
    expect(metrics.videos).toBe(1);
    expect(metrics.payoff).toEqual({ meanAbsS: 6, compared: 1, oneMissing: 0 });
  });
});

describe("averageMetrics and gateChecks", () => {
  it("averages each metric over run pairs and applies the spec's thresholds", () => {
    const perfect = pairMetrics([run("a", 100, base)], [run("a", 100, base)]);
    const average = averageMetrics([perfect, { ...perfect, boundaryF1: 0.5, beatTypeKappa: 0.4 }]);
    expect(average.boundaryF1).toBe(0.75);
    expect(average.beatTypeKappa).toBeCloseTo(0.7, 12);
    const gate = gateChecks({ ...average, framingKappa: 0.69 });
    expect(gate.passed).toBe(false);
    expect(gate.checks.filter((c) => !c.passed).map((c) => c.metric)).toEqual(["framing kappa"]);
  });

  it("reports an undefined kappa without failing the gate on it", () => {
    const metrics = pairMetrics([run("a", 100, base)], [run("a", 100, base)]);
    expect(gateChecks({ ...metrics, framingKappa: null }).passed).toBe(true);
  });
});

describe("topConfusions", () => {
  it("lists the most frequent disagreements, in either order", () => {
    const swapped: BeatSpec[] = [
      [0, 10, "hook"],
      [10, 40, "context"],
      [40, 90, "example"],
      [90, 100, "outro"],
    ];
    const confusions = topConfusions(
      [[run("a", 100, base)], [run("a", 100, swapped)], [run("a", 100, base)]],
      "beat_type",
    );
    expect(confusions).toEqual([
      { first: "demonstration", second: "example", seconds: 100 },
      { first: "context", second: "setup", seconds: 60 },
    ]);
  });
});

describe("runsIdentical", () => {
  it("is true only when every run matches exactly", () => {
    const a = [run("a", 100, base), run("b", 30, [[0, 30, "performance"]])];
    expect(runsIdentical([a, [...a].reverse(), a])).toBe(true);
    expect(runsIdentical([a, [run("a", 100, base, 5), a[1]!]])).toBe(false);
    expect(runsIdentical([a])).toBe(false);
  });
});
