import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildBins, type FeatureBeat, type FeatureVideo } from "../features";
import type { ModelArtifact } from "../schemas";
import {
  applyEdits,
  compareCuts,
  cutSampler,
  presentWeights,
  simulateCut,
  type CutEdit,
} from "./counterfactual";
import { predictCut, type AudienceMix } from "./cut";
import { loadArtifact, percentiles } from "./runtime";

const base = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** A made-up model: tangents make viewers leave much faster, energy keeps them. */
function model(
  audience: "subscribed" | "unsubscribed",
  tangent: number,
  extra: { name: string; beta: number }[] = [],
): ModelArtifact {
  const names = ["pos_b1", "beat_tangent", "energy", ...extra.map((e) => e.name)];
  const size = names.length + 1;
  return {
    ...base,
    audience,
    featureNames: names,
    droppedFeatures: [],
    unpenalized: ["pos_b1"],
    mean: names.map((name) => (name === "energy" ? 3 : 0)),
    sd: names.map(() => 1),
    alpha: -4,
    beta: [0.2, tangent, -0.3, ...extra.map((e) => e.beta)],
    cov: Array.from({ length: size }, (_, i) =>
      Array.from({ length: size }, (_, j) => (i === j ? 0.002 : 0)),
    ),
  };
}

const models = {
  subscribed: { artifact: model("subscribed", 1.0), inflation: 1 },
  unsubscribed: {
    artifact: model("unsubscribed", 2.0, [{ name: "mix_search", beta: 0.5 }]),
    inflation: 1,
  },
};

const beat = (start: number, end: number, extra: Partial<FeatureBeat> = {}): FeatureBeat => ({
  start_s: start,
  end_s: end,
  beat_type: "explanation",
  talking_head_share: 3,
  visual: "b_roll",
  cuts_per_min: 10,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "words",
  words_per_minute: 150,
  ...extra,
});

/** 4 minutes: hook, explanation, a 50 s tangent, a sponsor read, the payoff at 2:40, an outro. */
const cut: FeatureVideo = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: 160,
  beats: [
    beat(0, 20, { beat_type: "hook", opens_loop: "Will it work?" }),
    beat(20, 80),
    beat(80, 130, { beat_type: "tangent" }),
    beat(130, 160, { beat_type: "sponsor" }),
    beat(160, 200, { beat_type: "payoff", closes_loop: true }),
    beat(200, 240, { beat_type: "outro" }),
  ],
};
const mix: AudienceMix = {
  mix: { search: 0.3, suggested: 0.5, browse: 0.1 },
  weights: { subscribed: 0.25, unsubscribed: 0.75 },
};
const order = (edits: CutEdit[]) => applyEdits(cut, 240, edits).spans.map((s) => s.beat);

describe("applyEdits", () => {
  it("changes nothing without edits: the bins are the cut's own", () => {
    const same = applyEdits(cut, 240, []);
    expect(same.durationS).toBe(240);
    expect(buildBins(same.video, 240, base.channelContext!, null).values).toEqual(
      buildBins(cut, 240, base.channelContext!, null).values,
    );
  });

  it("shortens the cut by exactly a removed beat and re-times the rest end to end", () => {
    const edited = applyEdits(cut, 240, [{ op: "remove", beat: 2 }]);
    expect(edited.durationS).toBe(190);
    expect(edited.spans.map((s) => [s.beat, s.startS, s.endS])).toEqual([
      [0, 0, 20],
      [1, 20, 80],
      [3, 80, 110],
      [4, 110, 150],
      [5, 150, 190],
    ]);
    expect(edited.video.beats.map((b) => [b.start_s, b.end_s])).toEqual(
      edited.spans.map((s) => [s.startS, s.endS]),
    );
  });

  it("trims a beat's second half, and moves beats before another or to the end", () => {
    const trimmed = applyEdits(cut, 240, [{ op: "trim", beat: 1, keep: 0.5 }]);
    expect(trimmed.durationS).toBe(210);
    expect(trimmed.spans[1]).toMatchObject({ beat: 1, startS: 20, endS: 50, fromS: 20, toS: 80 });
    expect(order([{ op: "move", beat: 3, to: 1 }])).toEqual([0, 3, 1, 2, 4, 5]);
    expect(order([{ op: "move", beat: 3, to: 6 }])).toEqual([0, 1, 2, 4, 5, 3]);
    // Two beats moved to the same place keep their order; a cut target passes to the next beat.
    expect(
      order([
        { op: "move", beat: 3, to: 1 },
        { op: "move", beat: 4, to: 1 },
      ]),
    ).toEqual([0, 3, 4, 1, 2, 5]);
    expect(
      order([
        { op: "remove", beat: 1 },
        { op: "move", beat: 4, to: 1 },
      ]),
    ).toEqual([0, 4, 2, 3, 5]);
  });

  it("carries the payoff time with its beat, and to the end when the payoff is cut", () => {
    expect(applyEdits(cut, 240, [{ op: "remove", beat: 2 }]).video.payoff_time_s).toBe(110);
    expect(applyEdits(cut, 240, [{ op: "move", beat: 4, to: 1 }]).video.payoff_time_s).toBe(20);
    // A payoff partway into a trimmed beat's cut half lands where the kept part ends.
    expect(
      applyEdits({ ...cut, payoff_time_s: 190 }, 240, [{ op: "trim", beat: 4, keep: 0.5 }]).video
        .payoff_time_s,
    ).toBe(180);
    const cutPayoff = applyEdits(cut, 240, [{ op: "remove", beat: 4 }]);
    expect(cutPayoff.video.payoff_time_s).toBe(cutPayoff.durationS);
  });

  it("refuses edits that cannot happen", () => {
    expect(() => applyEdits(cut, 240, [{ op: "remove", beat: 6 }])).toThrow(RangeError);
    expect(() =>
      applyEdits(cut, 240, [
        { op: "remove", beat: 1 },
        { op: "trim", beat: 1, keep: 0.5 },
      ]),
    ).toThrow(/two edits/);
    expect(() => applyEdits(cut, 240, [{ op: "trim", beat: 1, keep: 1 }])).toThrow(RangeError);
    expect(() => applyEdits(cut, 240, [{ op: "move", beat: 2, to: 2 }])).toThrow(RangeError);
    expect(() =>
      applyEdits(
        cut,
        240,
        cut.beats.map((_, beat) => ({ op: "remove" as const, beat })),
      ),
    ).toThrow(/Every beat/);
  });
});

describe("simulating edits", () => {
  const sampler = cutSampler(models, { seed: 1, draws: 100 });
  const baseline = simulateCut(sampler, { video: cut, durationS: 240 }, mix.mix);
  const withEdits = (edits: CutEdit[]) =>
    simulateCut(sampler, applyEdits(cut, 240, edits), mix.mix);

  it("predicts the unedited cut on predictCut's own draws", () => {
    const predicted = predictCut(cut, 240, models, mix, { seed: 1, draws: 100 });
    for (const audience of ["subscribed", "unsubscribed"] as const) {
      const ours = percentiles(baseline.avp[audience] as Float64Array);
      const theirs = predicted.audiences[audience]?.avp ?? expect.fail(audience);
      expect(ours.p10).toBeCloseTo(theirs.p10, 9);
      expect(ours.p50).toBeCloseTo(theirs.p50, 9);
      expect(ours.p90).toBeCloseTo(theirs.p90, 9);
    }
  });

  it("raises predicted retention when the beat the model blames is removed", () => {
    const comparison = compareCuts(
      sampler,
      baseline,
      withEdits([{ op: "remove", beat: 2 }]),
      mix.weights,
      "avp",
    );
    expect(comparison.delta.p10).toBeGreaterThan(0);
    // Newcomers react twice as much to tangents, and are 75% of views.
    expect(comparison.driver).toBe("unsubscribed");
    expect(comparison.byAudience.unsubscribed?.p50).toBeGreaterThan(
      comparison.byAudience.subscribed?.p50 ?? Infinity,
    );
  });

  it("keeps the change's interval tight: the same draws on both sides", () => {
    const shared = compareCuts(
      sampler,
      baseline,
      withEdits([{ op: "remove", beat: 2 }]),
      mix.weights,
      "avp",
    );
    // The same edit predicted on other draws: what comparing independent predictions would give.
    const other = cutSampler(models, { seed: 2, draws: 100 });
    const independent = compareCuts(
      sampler,
      baseline,
      simulateCut(other, applyEdits(cut, 240, [{ op: "remove", beat: 2 }]), mix.mix),
      mix.weights,
      "avp",
    );
    const width = (p: { p10: number; p90: number }) => p.p90 - p.p10;
    expect(width(shared.delta)).toBeLessThan(width(independent.delta) / 2);
  });

  it("gives the same numbers for the same edits, every time", () => {
    const edits: CutEdit[] = [
      { op: "trim", beat: 1, keep: 0.5 },
      { op: "move", beat: 3, to: 5 },
    ];
    const again = cutSampler(models, { seed: 1, draws: 100 });
    expect(simulateCut(again, applyEdits(cut, 240, edits), mix.mix)).toEqual(withEdits(edits));
  });

  it("counts seconds watched by default, which a shorter cut does not flatter", () => {
    // Every beat alike: each bin loses the same share, so cutting one keeps the percentage...
    const flat: FeatureVideo = {
      ...cut,
      payoff_time_s: null,
      beats: cut.beats.map((b) => ({
        ...b,
        beat_type: "explanation",
        opens_loop: null,
        closes_loop: false,
      })),
    };
    const before = simulateCut(sampler, { video: flat, durationS: 240 }, mix.mix);
    const after = simulateCut(sampler, applyEdits(flat, 240, [{ op: "remove", beat: 1 }]), mix.mix);
    const share = compareCuts(sampler, before, after, mix.weights, "avp");
    const seconds = compareCuts(sampler, before, after, mix.weights);
    expect(Math.abs(share.delta.p50)).toBeLessThan(0.5);
    // ...but loses seconds watched.
    expect(seconds.delta.p90).toBeLessThan(0);
  });

  it("weighs the audiences that have a model, and gives bands when asked", () => {
    const alone = cutSampler({ unsubscribed: models.unsubscribed }, { seed: 1, draws: 20 });
    expect(presentWeights(alone, mix.weights)).toEqual({ subscribed: 0, unsubscribed: 1 });
    const banded = simulateCut(alone, { video: cut, durationS: 240 }, mix.mix, { bands: true });
    expect(banded.bands.unsubscribed?.p50).toHaveLength(100);
    expect(banded.bands.subscribed).toBeUndefined();
    expect(() => cutSampler({}, { seed: 1 })).toThrow(RangeError);
  });
});
