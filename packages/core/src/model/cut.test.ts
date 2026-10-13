import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { FeatureBeat, FeatureVideo } from "../features";
import { audienceWeightsSchema, scenarioSchema, type ModelArtifact } from "../schemas";
import {
  SCENARIO_DOMINANT_SHARE,
  averageViewPct,
  percentileAmong,
  predictCut,
  recentAudienceMix,
  scenarioAudienceMix,
  type AudienceMix,
} from "./cut";
import { loadArtifact } from "./runtime";

/** The newcomer model the cross-language parity test uses (49 columns, mix included). */
const newcomers = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);

/** A small subscriber model: position and energy only. */
const subscribers: ModelArtifact = {
  ...newcomers,
  audience: "subscribed",
  featureNames: ["pos_b1", "energy"],
  droppedFeatures: [],
  unpenalized: ["pos_b1"],
  mean: [0.3, 3],
  sd: [0.2, 1],
  alpha: -3.5,
  beta: [0.4, -0.3],
  cov: [
    [0.04, 0.012, -0.006],
    [0.012, 0.09, 0.018],
    [-0.006, 0.018, 0.0225],
  ],
};

const beat = (start: number, end: number, extra: Partial<FeatureBeat> = {}): FeatureBeat => ({
  start_s: start,
  end_s: end,
  beat_type: "explanation",
  talking_head_share: 4,
  visual: "none",
  cuts_per_min: 6,
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

/** A 4-minute cut: a hook, a sponsor read and the main part. */
const cut: FeatureVideo = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: 200,
  beats: [
    beat(0, 20, { beat_type: "hook", energy: 4, opens_loop: "Will it work?" }),
    beat(20, 60, { beat_type: "sponsor", energy: 2 }),
    beat(60, 240, { closes_loop: true }),
  ],
};

const recent: AudienceMix = {
  mix: { search: 0.2, suggested: 0.5, browse: 0.2 },
  weights: { subscribed: 0.25, unsubscribed: 0.75 },
};
const both = {
  subscribed: { artifact: subscribers, inflation: 1 },
  unsubscribed: { artifact: newcomers, inflation: 1 },
};

describe("averageViewPct", () => {
  it("is the area under the share still watching, from everyone at the start", () => {
    expect(averageViewPct(new Float64Array(100).fill(1))).toBe(100);
    // Everyone gone after the first bin: half of it, by trapezoid.
    expect(averageViewPct(new Float64Array(100))).toBeCloseTo(0.5, 12);
    // A straight line down to nobody watches half.
    expect(
      averageViewPct(Float64Array.from({ length: 100 }, (_, i) => 1 - (i + 1) / 100)),
    ).toBeCloseTo(50, 12);
  });
});

describe("percentileAmong", () => {
  it("is the share of recent videos below the prediction, ties counting half", () => {
    expect(percentileAmong(40, [30, 35, 50, 60])).toBe(50);
    expect(percentileAmong(40, [40, 30])).toBe(75);
    expect(percentileAmong(70, [30, 35])).toBe(100);
    expect(percentileAmong(40, [])).toBeNull();
  });
});

describe("audience mixes", () => {
  it("average the newcomer mix of recent videos and weigh audiences by their views", () => {
    const fallback = { search: 0.1, suggested: 0.1, browse: 0.1 };
    expect(
      recentAudienceMix(
        [
          {
            mix: { search: 0.2, suggested: 0.6, browse: 0.2 },
            views: { subscribed: 30, unsubscribed: 70 },
          },
          { mix: null, views: { subscribed: 10, unsubscribed: 90 } },
          {
            mix: { search: 0.4, suggested: 0.2, browse: 0.2 },
            views: { subscribed: 0, unsubscribed: 0 },
          },
        ],
        fallback,
      ),
    ).toEqual({
      mix: {
        search: expect.closeTo(0.3, 12),
        suggested: expect.closeTo(0.4, 12),
        browse: expect.closeTo(0.2, 12),
      },
      weights: { subscribed: 0.2, unsubscribed: 0.8 },
    });
    expect(recentAudienceMix([], fallback)).toEqual({
      mix: fallback,
      weights: { subscribed: 0.5, unsubscribed: 0.5 },
    });
  });

  it("make the named source or audience dominant, and keep shares and weights whole", () => {
    expect(scenarioAudienceMix("recent", recent)).toEqual(recent);

    const search = scenarioAudienceMix("search", recent);
    expect(search.mix.search).toBe(SCENARIO_DOMINANT_SHARE);
    // The other sources (and those outside the mix) shrink in proportion: 0.3 / 0.8 of before.
    expect(search.mix.suggested).toBeCloseTo(0.5 * (0.3 / 0.8), 12);
    expect(search.mix.browse).toBeCloseTo(0.2 * (0.3 / 0.8), 12);
    expect(search.weights).toEqual(recent.weights);

    // A source already above the dominant share keeps it.
    const mostly = { ...recent, mix: { search: 0.9, suggested: 0.05, browse: 0 } };
    expect(scenarioAudienceMix("search", mostly).mix).toEqual(mostly.mix);
    expect(
      scenarioAudienceMix("suggested", { ...recent, mix: { search: 0, suggested: 1, browse: 0 } })
        .mix,
    ).toEqual({ search: 0, suggested: 1, browse: 0 });

    const subscribed = scenarioAudienceMix("subscribers", recent);
    expect(subscribed.weights.subscribed).toBe(SCENARIO_DOMINANT_SHARE);
    expect(subscribed.mix).toEqual(recent.mix);

    for (const scenario of scenarioSchema.options) {
      const { mix, weights } = scenarioAudienceMix(scenario, recent);
      expect(audienceWeightsSchema.safeParse(weights).success, scenario).toBe(true);
      expect(mix.search + mix.suggested + mix.browse, scenario).toBeLessThanOrEqual(1 + 1e-12);
    }
  });
});

describe("predictCut", () => {
  const predict = (mix = recent, seed = 7) => predictCut(cut, 240, both, mix, { seed, draws: 100 });

  it("gives each audience an ordered band and ranges, in seconds and percent", () => {
    const prediction = predict();
    for (const audience of ["subscribed", "unsubscribed"] as const) {
      const { band, avp, avdS } = prediction.audiences[audience] ?? expect.fail(audience);
      expect(band.p50).toHaveLength(100);
      for (let bin = 0; bin < 100; bin += 1) {
        expect(band.p10[bin]).toBeLessThanOrEqual(band.p50[bin] as number);
        expect(band.p50[bin]).toBeLessThanOrEqual(band.p90[bin] as number);
      }
      expect(avp.p10).toBeLessThan(avp.p90);
      expect(avp.p50).toBeGreaterThan(0);
      expect(avp.p50).toBeLessThan(100);
      expect(avdS.p50).toBeCloseTo((avp.p50 / 100) * 240, 9);
    }
    expect(prediction.weights).toEqual(recent.weights);
    // The combined number lies between the audiences' own.
    const { subscribed, unsubscribed } = prediction.audiences;
    const low = Math.min(subscribed?.avp.p50 ?? 0, unsubscribed?.avp.p50 ?? 0);
    const high = Math.max(subscribed?.avp.p50 ?? 0, unsubscribed?.avp.p50 ?? 0);
    expect(prediction.avp.p50).toBeGreaterThanOrEqual(low - 1);
    expect(prediction.avp.p50).toBeLessThanOrEqual(high + 1);
  });

  it("repeats exactly from its seed, and changes with it", () => {
    expect(predict()).toEqual(predict());
    expect(predict(recent, 8).avp).not.toEqual(predict().avp);
  });

  it("moves newcomers, and only newcomers, with the traffic scenario", () => {
    const search = predict(scenarioAudienceMix("search", recent));
    const suggested = predict(scenarioAudienceMix("suggested", recent));
    expect(search.audiences.unsubscribed?.avp).not.toEqual(suggested.audiences.unsubscribed?.avp);
    expect(search.audiences.subscribed).toEqual(suggested.audiences.subscribed);
  });

  it("weighs only the audiences that have a model", () => {
    const alone = predictCut(cut, 240, { unsubscribed: both.unsubscribed }, recent, {
      seed: 7,
      draws: 100,
    });
    expect(alone.weights).toEqual({ subscribed: 0, unsubscribed: 1 });
    expect(alone.avp).toEqual(alone.audiences.unsubscribed?.avp);
    expect(alone.audiences.subscribed).toBeUndefined();
  });

  it("refuses a cut with no model, a model for another audience, or a pooled model", () => {
    expect(() => predictCut(cut, 240, {}, recent, { seed: 7 })).toThrow(RangeError);
    expect(() =>
      predictCut(cut, 240, { subscribed: both.unsubscribed }, recent, { seed: 7 }),
    ).toThrow(/predicts unsubscribed/);
    expect(() =>
      predictCut(
        cut,
        240,
        { subscribed: { artifact: { ...subscribers, channelContext: null }, inflation: 1 } },
        recent,
        { seed: 7 },
      ),
    ).toThrow(/not a channel's model/);
  });

  it("widens the bands with the calibration factor", () => {
    const calibrated = predictCut(
      cut,
      240,
      { unsubscribed: { artifact: newcomers, inflation: 4 } },
      recent,
      { seed: 7, draws: 100 },
    );
    const plain = predictCut(cut, 240, { unsubscribed: both.unsubscribed }, recent, {
      seed: 7,
      draws: 100,
    });
    const spread = (p: { p10: number; p90: number }) => p.p90 - p.p10;
    expect(spread(calibrated.avp)).toBeGreaterThan(spread(plain.avp));
  });
});
