import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import type { FeatureVideo } from "@soundcheck/core/features";
import type { Narration } from "@soundcheck/core/gemini";
import type { Trait } from "@soundcheck/core/model";
import type { ModelArtifact, TrainingAudience, VideoBeat } from "@soundcheck/core/schemas";
import { hazards } from "@soundcheck/core/stats";
import { describe, expect, it } from "vitest";
import type { CurvePoint } from "../features/inputs";
import type { TraitsResult } from "../traits/run";
import { assemble, finalize, holdoutResults, topTraits, type Draft } from "./assemble";
import type { PublishInputs } from "./read";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OLD = "vidOld12345";
const NEW = "vidNew12345";
const OPTIONS = {
  channelId: CHANNEL,
  runId: "pub1",
  generatedAt: "2026-10-11T09:00:00.000Z",
  draws: 50,
  seed: 3,
};

const beat = (start: number, end: number, type: string) => ({
  start_s: start,
  end_s: end,
  beat_type: type,
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
// A 200 s video with a sponsor read from 60 s to 90 s (bins 31 to 45).
const extraction = {
  format: "tutorial",
  target_level: 2,
  payoff_time_s: null,
  beats: [beat(0, 60, "hook"), beat(60, 90, "sponsor"), beat(90, 200, "explanation")],
} as FeatureVideo;

/** A measured curve: 10 points lost in bin 1, 0.3 a bin, and `spike` more in bins 32 to 34. */
function curvePoints(spike: number): CurvePoint[] {
  let still = 1;
  const survival = Array.from({ length: 100 }, (_, i) => {
    const loss = i === 0 ? 10 : i >= 31 && i <= 33 ? 0.3 + spike : 0.3;
    return (still -= loss / 100);
  });
  return survival.map((sMono, i) => ({
    bin: i + 1,
    sMono,
    hazard: hazards(survival)[i] as number,
    asOf: "2026-10-03",
  }));
}

function artifact(audience: TrainingAudience): ModelArtifact {
  const names = [
    "pos_b1",
    "beat_sponsor",
    "energy",
    ...(audience === "unsubscribed" ? ["mix_search"] : []),
  ];
  return {
    runId: "run1",
    channelId: CHANNEL,
    audience,
    modelVersion: MODEL_VERSION,
    featureVersion: FEATURE_VERSION,
    extractionVersion: EXTRACTION_VERSION,
    createdAt: "2026-10-11T08:00:00.000Z",
    featureNames: names,
    droppedFeatures: [],
    unpenalized: ["pos_b1"],
    mean: names.map(() => 0),
    sd: names.map(() => 1),
    alpha: -5,
    beta: names.map((name) => (name === "beat_sponsor" ? 0.8 : 0)),
    cov: Array.from({ length: names.length + 1 }, (_, i) =>
      Array.from({ length: names.length + 1 }, (_, j) => (i === j ? 0.01 : 0)),
    ),
    lambda: 3,
    priorRef: null,
    trainChannelIds: [CHANNEL],
    trainVideoIds: [OLD],
    channelContext: { medianTargetLevel: 2, mixMean: { search: 0.4, suggested: 0.4, browse: 0.2 } },
    usable: false,
    unusableReasons: ["trained on 1 videos; at least 30 are needed"],
    metrics: {
      rows: 300,
      videos: 1,
      trainLoss: 0.05,
      cv: [],
      folds: 3,
      iterations: 10,
      converged: true,
      gradientNorm: 1e-9,
      dispersion: 0.002,
      effectiveParameters: 4,
    },
  };
}

const videoBeats: VideoBeat[] = extraction.beats.map((b) => ({
  startS: b.start_s,
  endS: b.end_s,
  beatType: b.beat_type,
  visual: "none",
  talkingHeadShare: 5,
  summary: `The ${b.beat_type}.`,
  transcriptExcerpt: b.transcript,
}));

function inputs(overrides: Partial<PublishInputs> = {}): PublishInputs {
  return {
    features: {
      videos: [
        { videoId: OLD, durationS: 200, eligible: true },
        { videoId: NEW, durationS: 120, eligible: true },
      ],
      extractions: new Map([[OLD, extraction]]),
      curves: new Map([
        [
          OLD,
          new Map<TrainingAudience, CurvePoint[]>([
            ["subscribed", curvePoints(2)],
            ["unsubscribed", curvePoints(3)],
          ]),
        ],
        [NEW, new Map<TrainingAudience, CurvePoint[]>([["unsubscribed", curvePoints(2.5)]])],
      ]),
      views: new Map(),
      newcomerMix: new Map([[OLD, { search: 0.5, suggested: 0.3, browse: 0.2 }]]),
    },
    videos: [
      {
        videoId: NEW,
        title: "New",
        publishedAt: "2026-09-01T12:00:00.000Z",
        durationS: 120,
        thumbnailUrl: null,
      },
      {
        videoId: OLD,
        title: "Old",
        publishedAt: "2026-08-01T12:00:00.000Z",
        durationS: 200,
        thumbnailUrl: "https://i.ytimg.com/vi/vidOld12345/hqdefault.jpg",
      },
    ],
    stats: new Map([
      [
        OLD,
        {
          subscribed: { views: 300, minutesWatched: 400, avp: 50 },
          unsubscribed: { views: 700, minutesWatched: 600, avp: 30 },
        },
      ],
      [NEW, { unsubscribed: { views: 100, minutesWatched: 50, avp: 25 } }],
    ]),
    beats: new Map([[OLD, videoBeats]]),
    models: new Map((["all", "subscribed", "unsubscribed"] as const).map((a) => [a, artifact(a)])),
    modelUris: new Map(),
    evaluation: null,
    ...overrides,
  };
}

const trait = (
  feature: string,
  deltaPp: number | null,
  low: number | null,
  high: number | null,
): Trait => ({
  feature,
  condition: `a ${feature} edit`,
  measured: deltaPp !== null,
  deltaPp,
  ciLow: low,
  ciHigh: high,
});
const traits: TraitsResult = {
  channelId: CHANNEL,
  video: { id: OLD, durationS: 200, outOf: 1 },
  audiences: [
    {
      audience: "subscribed",
      runId: "run1",
      usable: false,
      unusableReasons: ["trained on 1 videos; at least 30 are needed"],
      traits: [
        trait("beat_sponsor", -2.04, -3.1, -1.2),
        trait("energy", 0.5, -0.2, 1.2),
        trait("beat_cta", null, null, null),
      ],
    },
  ],
  estimated: [{ source: "search", shown: false, reasons: ["too few videos"], traits: [] }],
};

/** Every caption from its template, as narration does when Gemini fails. */
const captions = (draft: Draft) =>
  new Map<string, Narration>(
    draft.batches.flat().map((item) => [item.id, { text: item.fallback, source: "template" }]),
  );

describe("assemble", () => {
  it("builds documents that pass their schemas, newest video first", () => {
    const draft = assemble(inputs(), traits, OPTIONS);
    const { summary, index, videos } = finalize(draft, captions(draft));
    expect(index.videos.map((video) => [video.videoId, video.inSample])).toEqual([
      [NEW, false],
      [OLD, true],
    ]);
    expect(videos.map((video) => video.videoId)).toEqual([NEW, OLD]);
    expect(summary).toMatchObject({ videosAnalysed: 1, beatsExtracted: 3, evaluation: null });
    expect(summary.headline).toBe(
      "Across 1 video, subscribers watch 50.0% and newcomers watch 29.4% of a video on average.",
    );
  });

  it("predicts and attributes drop-offs where a model and beats exist, and only measures them elsewhere", () => {
    const draft = assemble(inputs(), traits, OPTIONS);
    const [fresh, trained] = finalize(draft, captions(draft)).videos;

    // The trained video: both audiences predicted by a stamped, not usable model.
    expect(trained?.audiences.subscribed?.model).toEqual({
      runId: "run1",
      usable: false,
      unusableReasons: ["trained on 1 videos; at least 30 are needed"],
      trainedVideos: 1,
    });
    expect(trained?.audiences.unsubscribed?.predicted?.p50).toHaveLength(100);
    const sponsorDrop = trained?.drops.find(
      (drop) => drop.audience === "unsubscribed" && drop.binStart <= 33 && drop.binEnd >= 32,
    );
    expect(sponsorDrop?.attributions[0]?.group).toBe("sponsor");
    for (const drop of trained?.drops ?? []) {
      expect(drop.attributions.reduce((sum, a) => sum + a.share, drop.residualShare)).toBeCloseTo(
        1,
        9,
      );
    }
    expect(trained?.beats[1]).toMatchObject({ beatType: "sponsor", summary: "The sponsor." });
    expect(trained?.stats).toEqual({ views: 1000, avdS: 60, avp: 36 });

    // The new video: no beats, so no prediction, and drop-offs without causes.
    expect(fresh?.audiences).toEqual({
      unsubscribed: expect.objectContaining({ predicted: null, model: null }),
    });
    expect(fresh?.drops.length).toBeGreaterThan(0);
    expect(
      fresh?.drops.every((drop) => drop.attributions.length === 0 && drop.residualShare === 1),
    ).toBe(true);
    expect(fresh?.beats).toEqual([]);
  });

  it("describes each measured audience from the stats, with its strongest clear traits", () => {
    const draft = assemble(inputs(), traits, OPTIONS);
    const { summary } = finalize(draft, captions(draft));
    expect(
      summary.audiences.map((card) => [
        card.key,
        card.viewShare,
        card.watchTimeShare,
        card.avgViewPct,
      ]),
    ).toEqual([
      ["subscribed", 0.2727, 0.381, 50],
      ["unsubscribed", 0.7273, 0.619, 29.4],
    ]);
    expect(summary.audiences[0]?.traits).toEqual([
      {
        feature: "beat_sponsor",
        statement: "A beat_sponsor edit: -2.0 points still watching at the end",
        deltaPp: -2.04,
        ci: [-3.1, -1.2],
      },
    ]);
    // The sheet lists every effect: measured ones by size, then those never learned.
    expect(summary.audiences[0]?.effects).toEqual([
      { feature: "beat_sponsor", label: "A beat_sponsor edit", deltaPp: -2.04, ci: [-3.1, -1.2] },
      { feature: "energy", label: "A energy edit", deltaPp: 0.5, ci: [-0.2, 1.2] },
      { feature: "beat_cta", label: "A beat_cta edit", deltaPp: null, ci: null },
    ]);
    // The hidden estimated audience gets no card.
    expect(summary.audiences.map((card) => card.key)).not.toContain("search");
    // Without models, the measured numbers stay and the traits go.
    const bare = assemble(inputs({ models: new Map() }), null, OPTIONS);
    const cards = finalize(bare, captions(bare)).summary.audiences;
    expect(cards.map((card) => [card.model, card.traits, card.effects])).toEqual([
      [null, [], []],
      [null, [], []],
    ]);
  });

  it("uses a held-out evaluation of the published models, and widens their bands by its factor", () => {
    const evaluation = {
      runId: "eval1",
      modelRunId: "run1",
      details: {
        audiences: {
          all: {
            b0_variant: "channel average" as const,
            summary: {
              model: { videos: 8, curve_mae_pp: 6.214 },
              b0_channel: { videos: 8, curve_mae_pp: 7.9 },
              b0_length: { videos: 8, curve_mae_pp: 8.4 },
            },
            inflation: { factor: 1 },
            bootstrap: { beats_b0: true },
          },
          unsubscribed: {
            b0_variant: "length matched" as const,
            summary: {},
            inflation: { factor: 9 },
            bootstrap: null,
          },
        },
      },
    };
    expect(holdoutResults(inputs({ evaluation }))).toEqual({
      evaluation: {
        runId: "eval1",
        testVideos: 8,
        modelErrorPp: 6.21,
        baselineErrorPp: 7.9,
        beatsBaseline: true,
      },
      inflation: { unsubscribed: 9 },
    });
    // An evaluation of an older fit says nothing about these models.
    expect(holdoutResults(inputs({ evaluation: { ...evaluation, modelRunId: "older" } }))).toEqual({
      evaluation: null,
      inflation: {},
    });

    const width = (draft: Draft) => {
      const band = draft.videos.find((video) => video.videoId === OLD)?.audiences.unsubscribed
        ?.predicted;
      return (band?.p90[60] ?? 0) - (band?.p10[60] ?? 0);
    };
    expect(width(assemble(inputs({ evaluation }), traits, OPTIONS))).toBeGreaterThan(
      2 * width(assemble(inputs(), traits, OPTIONS)),
    );
  });
});

describe("topTraits", () => {
  it("keeps the three largest effects whose interval excludes zero", () => {
    const list = [
      trait("a", 1, 0.5, 1.5),
      trait("b", -4, -5, -3),
      trait("c", 2, -0.1, 3),
      trait("d", 3, 2, 4),
      trait("e", -0.8, -1, -0.004),
      trait("f", 0.6, 0.2, 1),
    ];
    expect(topTraits(list).map((card) => card.feature)).toEqual(["b", "d", "a"]);
    // An interval that only clears zero before rounding is not clear.
    expect(topTraits([trait("e", -0.8, -1, -0.004)])).toEqual([]);
  });
});
