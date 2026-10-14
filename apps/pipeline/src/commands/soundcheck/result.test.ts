import { readFileSync } from "node:fs";
import { loadArtifact, predictCut, type AudienceMix } from "@soundcheck/core/model";
import {
  soundcheckInputsSchema,
  soundcheckPredictionSchema,
  type ModelArtifact,
  type VideoBeats,
} from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import type { ChannelModel } from "./channel";
import { displayBeats, editsDoc, effectDoc, inputsDoc, narrative, predictionDoc } from "./result";

const newcomers = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);
const subscribers: ModelArtifact = {
  ...newcomers,
  runId: "subscribedRun",
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
const models: Partial<Record<"subscribed" | "unsubscribed", ChannelModel>> = {
  subscribed: { artifact: subscribers, artifactUri: "gs://media/models/sub.json", inflation: 1 },
  unsubscribed: { artifact: newcomers, artifactUri: "gs://media/models/new.json", inflation: 1.3 },
};

const beat = (start: number, end: number, extra: Partial<VideoBeats["beats"][number]> = {}) => ({
  start_s: start,
  end_s: end,
  beat_type: "explanation" as const,
  talking_head_share: 4,
  visual: "none" as const,
  cuts_per_min: 6,
  on_screen_text: false,
  music: "none" as const,
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  speaker_count: 1,
  transcript: "We take the old bridge apart, plank by plank, before the river rises again tonight.",
  summary: "Taking the bridge apart.",
  words_per_minute: 150,
  ...extra,
});
const extraction: VideoBeats = {
  schema_version: "beats-v3",
  video_summary: "Rebuilding a bridge.",
  format: "tutorial",
  title_promise: "Will the bridge hold?",
  target_level: 2,
  payoff_time_s: 200,
  beats: [
    beat(0, 20, { beat_type: "hook", opens_loop: "Will the bridge hold?" }),
    beat(20, 240, { closes_loop: true, transcript: "" }),
  ],
} as VideoBeats;
const mix: AudienceMix = {
  mix: { search: 0.2, suggested: 0.5, browse: 0.2 },
  weights: { subscribed: 0.2105, unsubscribed: 0.7895 },
};
const predicted = predictCut(
  extraction,
  240,
  { subscribed: models.subscribed, unsubscribed: models.unsubscribed } as never,
  mix,
  { seed: 1, draws: 50 },
);

describe("a soundcheck's result", () => {
  it("shows its beats as a video page does, with a transcript excerpt", () => {
    expect(displayBeats(extraction.beats)).toEqual([
      expect.objectContaining({
        startS: 0,
        endS: 20,
        beatType: "hook",
        summary: "Taking the bridge apart.",
      }),
      expect.objectContaining({ startS: 20, endS: 240, transcriptExcerpt: "" }),
    ]);
  });

  it("stores the prediction rounded, stamped, weighted to 1 and compared with recent videos", () => {
    const doc = predictionDoc(predicted, models, [30, 35, 80]);
    expect(soundcheckPredictionSchema.parse(doc)).toEqual(doc);
    expect(doc.weights).toEqual({ subscribed: 0.2105, unsubscribed: 0.7895 });
    expect(doc.audiences.unsubscribed?.model).toMatchObject({
      runId: newcomers.runId,
      usable: false,
    });
    expect(doc.audiences.subscribed?.model.runId).toBe("subscribedRun");
    expect(doc.comparedVideos).toBe(3);
    expect(doc.percentileVsChannel).toBeGreaterThanOrEqual(0);
    const alone = predictionDoc(predicted, models, []);
    expect(alone).toMatchObject({ percentileVsChannel: null, comparedVideos: 0 });
  });

  it("says it in one sentence from its own numbers", () => {
    const doc = {
      ...predictionDoc(predicted, models, []),
      audiences: {
        subscribed: {
          ...predictionDoc(predicted, models, []).audiences.subscribed!,
          avp: { p10: 40.2, p50: 46.4, p90: 51.8 },
        },
        unsubscribed: {
          ...predictionDoc(predicted, models, []).audiences.unsubscribed!,
          avp: { p10: 31.6, p50: 38.2, p90: 44.4 },
        },
      },
    };
    expect(narrative(doc)).toBe(
      "Subscribers should watch about 46% of this cut (40 to 52%), and newcomers about 38% (32 to 44%).",
    );
    expect(narrative({ ...doc, percentileVsChannel: 66.7, comparedVideos: 3 })).toMatch(
      /That is better than 67% of your 3 recent videos\.$/,
    );
    expect(
      narrative({
        ...doc,
        audiences: { unsubscribed: doc.audiences.unsubscribed },
        percentileVsChannel: 100,
        comparedVideos: 1,
      }),
    ).toBe(
      "Newcomers should watch about 38% of this cut (32 to 44%). That is better than 100% of your 1 recent video.",
    );
  });

  it("saves the cut as the model reads it, with no transcript text", () => {
    const prediction = predictionDoc(predicted, models, []);
    const inputs = inputsDoc({
      soundcheckId: "8f14e45fceea167a5a36dedd4bea2543",
      channelId: "UC-BHlgFbFh3V76yth-XCmlw",
      durationS: 240,
      extraction,
      scenario: "recent",
      audienceMix: mix,
      prediction,
      models,
      seed: 1,
      createdAt: "2026-10-13T09:00:00.000Z",
    });
    expect(soundcheckInputsSchema.parse(inputs)).toEqual(inputs);
    expect(JSON.stringify(inputs)).not.toMatch(/bridge|plank/i);
    expect(inputs.beats.map((b) => [b.opensLoop, b.speaks])).toEqual([
      [true, true],
      [false, false],
    ]);
    expect(inputs.models.unsubscribed).toMatchObject({
      artifactUri: "gs://media/models/new.json",
      inflation: 1.3,
    });
    expect(inputs.channel).toEqual(newcomers.channelContext);
  });

  it("stores edits rounded, with their own effect, driver and recommendation", () => {
    const comparison = (p50: number) => ({
      delta: { p10: p50 - 1.23456, p50, p90: p50 + 1.23456 },
      byAudience: {},
      driver: "unsubscribed" as const,
    });
    const [stored] = editsDoc([
      {
        id: "remove-2",
        edit: { op: "remove", beat: 2 },
        startS: 80.0049,
        endS: 130,
        avdS: comparison(9.512),
        avp: comparison(3.2049),
        sure: true,
        label: "Cut the tangent at 1:20 (50 s)",
        rationale:
          "Newcomers are predicted to leave faster during it, mostly because of the tangent.",
        recommended: true,
      },
    ]);
    expect(stored).toEqual({
      editId: "remove-2",
      edit: { op: "remove", beat: 2 },
      startS: 80,
      endS: 130,
      label: "Cut the tangent at 1:20 (50 s)",
      rationale:
        "Newcomers are predicted to leave faster during it, mostly because of the tangent.",
      deltaAvdS: { p10: 8.3, p50: 9.5, p90: 10.7 },
      deltaAvpPp: { p10: 1.97, p50: 3.2, p90: 4.44 },
      audienceDriver: "unsubscribed",
      recommended: true,
    });
    expect(effectDoc(null)).toBeNull();
    expect(effectDoc({ avdS: comparison(12.44), avp: comparison(5.123) })).toEqual({
      deltaAvdS: { p10: 11.2, p50: 12.4, p90: 13.7 },
      deltaAvpPp: { p10: 3.89, p50: 5.12, p90: 6.36 },
    });
  });
});
