import { describe, expect, it } from "vitest";
import type { FeatureBeat, FeatureVideo } from "../features";
import type { ModelArtifact } from "../schemas";
import { SCENARIOS, estimatedAudiences, overlay, traits } from "./effects";

const beat = (
  start_s: number,
  end_s: number,
  beat_type: FeatureBeat["beat_type"],
): FeatureBeat => ({
  start_s,
  end_s,
  beat_type,
  talking_head_share: 5,
  visual: "none",
  cuts_per_min: 2,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "Words.",
  words_per_minute: 150,
});

const video: FeatureVideo = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: null,
  beats: [beat(0, 30, "hook"), beat(30, 270, "explanation"), beat(270, 300, "outro")],
};

/**
 * A subscriber model in which sponsor time is strongly associated with
 * leaving and energy not at all (its coefficient is 0).
 */
const model: ModelArtifact = {
  runId: "run1",
  channelId: "UCaBcDeFgHiJkLmNoPqRsTuV",
  audience: "subscribed",
  modelVersion: "hazard-v1",
  featureVersion: "feat-test",
  extractionVersion: "beats-v5",
  createdAt: "2026-10-11T09:00:00.000Z",
  featureNames: ["pos_b1", "beat_sponsor", "energy"],
  droppedFeatures: [],
  unpenalized: ["pos_b1"],
  mean: [0.2, 0.05, 3],
  sd: [0.2, 0.2, 1],
  alpha: -4.5,
  beta: [0, 0.4, 0],
  cov: [
    [0.01, 0, 0, 0],
    [0, 0.01, 0, 0],
    [0, 0, 0.0004, 0],
    [0, 0, 0, 0.01],
  ],
  lambda: 3,
  priorRef: null,
  trainChannelIds: ["UCaBcDeFgHiJkLmNoPqRsTuV"],
  trainVideoIds: Array.from({ length: 40 }, (_, i) => `v${i}`),
  channelContext: { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.1, browse: 0.5 } },
  usable: true,
  unusableReasons: [],
  metrics: {
    rows: 4000,
    videos: 40,
    trainLoss: 0.05,
    cv: [],
    folds: 5,
    iterations: 20,
    converged: true,
    gradientNorm: 1e-9,
  },
};

describe("overlay", () => {
  it("changes only the span, splitting the beats that cross its edges", () => {
    const edited = overlay(video, 20, 50, { beat_type: "sponsor" });
    expect(edited.beats.map((b) => [b.start_s, b.end_s, b.beat_type])).toEqual([
      [0, 20, "hook"],
      [20, 30, "sponsor"],
      [30, 50, "sponsor"],
      [50, 270, "explanation"],
      [270, 300, "outro"],
    ]);
    expect(video.beats).toHaveLength(3);
  });
});

describe("traits", () => {
  const byFeature = (list: ReturnType<typeof traits>) =>
    Object.fromEntries(list.map((trait) => [trait.feature, trait]));
  const result = byFeature(traits(model, video, 300, null, { draws: 400, seed: 3 }));

  it("finds the sponsor read costs viewers, with an interval that excludes zero", () => {
    const sponsor = result.beat_sponsor;
    expect(sponsor).toMatchObject({ condition: "a 30 s sponsor read at 30%", measured: true });
    expect(sponsor?.deltaPp).toBeLessThan(-1);
    expect(sponsor?.ciHigh).toBeLessThan(0);
    expect(sponsor?.ciLow).toBeLessThan(sponsor?.deltaPp as number);
  });

  it("finds no effect of energy, whose coefficient is 0, and an interval around zero", () => {
    const energy = result.energy;
    expect(energy?.deltaPp).toBeCloseTo(0, 10);
    expect(energy?.ciLow).toBeLessThan(0);
    expect(energy?.ciHigh).toBeGreaterThan(0);
  });

  it("does not put a number on features the model never learned", () => {
    expect(result.beat_cta).toEqual({
      feature: "beat_cta",
      condition: "a 15 s call to action at 50%",
      measured: false,
      deltaPp: null,
      ciLow: null,
      ciHigh: null,
    });
    expect(Object.keys(result)).toHaveLength(SCENARIOS.length);
  });

  it("is the same for a seed and refuses the pooled model", () => {
    expect(traits(model, video, 300, null, { draws: 50, seed: 9 })).toEqual(
      traits(model, video, 300, null, { draws: 50, seed: 9 }),
    );
    expect(() =>
      traits({ ...model, channelId: null, channelContext: null }, video, 300, null),
    ).toThrow(/channel's model/);
  });

  it("keeps every scenario's edit inside the video, even a short one", () => {
    for (const scenario of SCENARIOS) {
      const edited = scenario.edit(video, 45);
      for (const b of edited.beats) {
        expect(b.end_s, scenario.condition).toBeGreaterThan(b.start_s);
      }
    }
  });
});

describe("estimatedAudiences", () => {
  const newcomers: ModelArtifact = {
    ...model,
    audience: "unsubscribed",
    featureNames: [...model.featureNames, "mix_search", "mix_browse"],
    mean: [...model.mean, 0, 0],
    sd: [...model.sd, 0.12, 0.05],
    beta: [...model.beta, 0.1, 0],
    cov: Array.from({ length: 6 }, (_, i) =>
      Array.from({ length: 6 }, (_, j) => (i === j ? (i === 2 ? 0.0004 : 0.01) : 0)),
    ),
  };

  it("shows a source only when its share varies enough across enough videos and a trait is clear", () => {
    const [search, suggested, browse] = estimatedAudiences(newcomers, video, 300, {
      draws: 200,
      seed: 5,
    });
    expect(search).toMatchObject({ source: "search", shown: true, reasons: [] });
    expect(suggested?.shown).toBe(false);
    expect(suggested?.reasons).toEqual([
      "its share varies by 0.00 across videos; at least 0.08 is needed",
    ]);
    expect(browse?.reasons).toEqual([
      "its share varies by 0.05 across videos; at least 0.08 is needed",
    ]);
  });

  it("hides every source with too few training videos", () => {
    const few = { ...newcomers, trainVideoIds: ["v1", "v2", "v3"] };
    const [search] = estimatedAudiences(few, video, 300, { draws: 100, seed: 5 });
    expect(search?.reasons).toEqual(["trained on 3 videos; at least 30 are needed"]);
    expect(() => estimatedAudiences(model, video, 300)).toThrow(/newcomer model/);
  });
});
