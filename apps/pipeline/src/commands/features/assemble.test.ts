import { EXTRACTION_VERSION, FEATURE_VERSION } from "@soundcheck/core";
import {
  FEATURE_NAMES,
  featureIndex,
  type FeatureBeat,
  type FeatureVideo,
  type TrafficMix,
} from "@soundcheck/core/features";
import type { TrainingAudience } from "@soundcheck/core/schemas";
import { survivalLabels } from "@soundcheck/core/stats";
import { describe, expect, it } from "vitest";
import { assembleTrainingBins } from "./assemble";
import type { CurvePoint, FeatureInputs } from "./inputs";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";

const beat = (start_s: number, end_s: number, beat_type: FeatureBeat["beat_type"]) => ({
  start_s,
  end_s,
  beat_type,
  talking_head_share: 5,
  visual: "none" as const,
  cuts_per_min: 0,
  on_screen_text: false,
  music: "none" as const,
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  transcript: "Hello there.",
  words_per_minute: 120,
});

const extraction = (targetLevel: number): FeatureVideo => ({
  format: "tutorial",
  target_level: targetLevel,
  payoff_time_s: 90,
  beats: [beat(0, 60, "hook"), beat(60, 120, "explanation")],
});

/** 10% leave in bin 1, then 0.4% of the starting audience per bin. */
function curve(asOf = "2026-10-07"): CurvePoint[] {
  const ratios = Array.from({ length: 100 }, (_, i) => 0.9 - 0.004 * i);
  const { sMono, hazard } = survivalLabels(ratios);
  return ratios.map((_, i) => ({
    bin: i + 1,
    sMono: sMono[i] as number,
    hazard: hazard[i] as number,
    asOf,
  }));
}

const curves = (audiences: TrainingAudience[], asOf?: string) =>
  new Map(audiences.map((audience) => [audience, curve(asOf)] as const));

const mixA: TrafficMix = { search: 0.5, suggested: 0.2, browse: 0.3 };
const mixB: TrafficMix = { search: 0.1, suggested: 0.4, browse: 0.5 };

/**
 * A and B are fully usable, G has only the `all` curve and no newcomer mix;
 * C is not eligible, D has no beats and E no complete curve.
 */
const inputs: FeatureInputs = {
  videos: ["vidA", "vidB", "vidC", "vidD", "vidE", "vidG"].map((videoId) => ({
    videoId,
    durationS: 120,
    eligible: videoId !== "vidC",
  })),
  extractions: new Map([
    ["vidA", extraction(1)],
    ["vidB", extraction(3)],
    ["vidC", extraction(2)],
    ["vidE", extraction(2)],
    ["vidG", extraction(5)],
  ]),
  curves: new Map([
    ["vidA", curves(["all", "subscribed", "unsubscribed"])],
    ["vidB", curves(["subscribed", "unsubscribed"], "2026-10-08")],
    ["vidC", curves(["all"])],
    ["vidD", curves(["all"])],
    ["vidG", curves(["all"])],
  ]),
  views: new Map([
    ["vidA", { subscribed: 40, unsubscribed: 160 }],
    ["vidB", { subscribed: 10, unsubscribed: 30 }],
  ]),
  newcomerMix: new Map([
    ["vidA", mixA],
    ["vidB", mixB],
  ]),
};

describe("assembleTrainingBins", () => {
  const bins = assembleTrainingBins(CHANNEL, inputs);
  const row = (videoId: string, audience: TrainingAudience, bin: number) => {
    const found = bins.rows.find(
      (r) => r.video_id === videoId && r.audience === audience && r.bin === bin,
    );
    if (!found) throw new Error(`No row for ${videoId} ${audience} ${bin}`);
    return found;
  };
  const x = (r: { x: number[] }, name: string) => r.x[featureIndex(name)];

  it("uses eligible videos with current beats and a complete curve, and says why others are left out", () => {
    expect(bins.used).toEqual(["vidA", "vidB", "vidG"]);
    expect(bins.skipped).toEqual([
      { videoId: "vidC", reason: "not eligible for training" },
      { videoId: "vidD", reason: `no ${EXTRACTION_VERSION} beats` },
      { videoId: "vidE", reason: "no complete retention curve" },
    ]);
    expect(bins.rowsByAudience).toEqual({ all: 200, subscribed: 200, unsubscribed: 200 });
    expect(bins.rows).toHaveLength(600);
    expect(bins.asOf).toBe("2026-10-08");
  });

  it("joins each bin to its hazard and weighs it by the audience's viewers still watching", () => {
    const first = row("vidA", "unsubscribed", 1);
    const second = row("vidA", "unsubscribed", 2);
    expect(first).toMatchObject({
      channel_id: CHANNEL,
      hazard: expect.closeTo(0.1, 12),
      n_at_risk: 160,
      video_views: 160,
      feature_version: FEATURE_VERSION,
      extraction_version: EXTRACTION_VERSION,
      as_of: "2026-10-07",
    });
    expect(second.n_at_risk).toBeCloseTo(160 * 0.9, 9);
    expect(row("vidA", "all", 1)).toMatchObject({ n_at_risk: 200, video_views: 200 });
    expect(row("vidA", "subscribed", 100).n_at_risk).toBeCloseTo(40 * (0.9 - 0.004 * 98), 9);
    expect(row("vidG", "all", 1)).toMatchObject({ n_at_risk: 0, video_views: 0 });
    expect(first.x).toHaveLength(FEATURE_NAMES.length);
  });

  it("centers newcomer mixes at the channel mean and leaves them out of the other audiences", () => {
    // The channel mean of A and B: search 0.3, suggested 0.3, browse 0.4.
    expect(bins.context).toEqual({
      medianTargetLevel: 3,
      mixMean: {
        search: expect.closeTo(0.3, 12),
        suggested: expect.closeTo(0.3, 12),
        browse: expect.closeTo(0.4, 12),
      },
    });
    const newcomers = row("vidA", "unsubscribed", 10);
    expect(x(newcomers, "mix_search")).toBeCloseTo(0.2, 12);
    expect(x(newcomers, "mix_suggested")).toBeCloseTo(-0.1, 12);
    // Target level 1 against the channel's median 3: knowledge gap 2 - 3 = -1.
    expect(x(newcomers, "knowledge_gap")).toBe(-1);
    expect(x(newcomers, "ix_knowledge_gap_search")).toBeCloseTo(-0.2, 12);
    const subscribers = row("vidA", "subscribed", 10);
    expect(x(subscribers, "mix_search")).toBe(0);
    expect(x(subscribers, "ix_knowledge_gap_search")).toBe(0);
    expect(subscribers.x).toEqual(row("vidA", "all", 10).x);
  });

  it("gives a video without a reported mix the channel mean", () => {
    expect(bins.missingMix).toEqual(["vidG"]);
  });

  it("writes nothing when no video is usable", () => {
    const none = assembleTrainingBins(CHANNEL, { ...inputs, extractions: new Map() });
    expect(none).toMatchObject({ rows: [], context: null, used: [], asOf: null });
    expect(none.skipped).toHaveLength(6);
  });
});
