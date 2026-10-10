import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import { SCENARIOS } from "@soundcheck/core/model";
import type { ModelArtifact } from "@soundcheck/core/schemas";
import type { FakeBigQuery, FakeStorage } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNEL, ingestTestbed, resetTestbed } from "../ingest/testbed";
import { buildTraits, formatTraits } from "./run";

const VIDEOS = [
  { id: "vidShort", duration: 60 },
  { id: "vidMiddle", duration: 120 },
  { id: "vidLong", duration: 300 },
];

function artifact(audience: "all" | "unsubscribed", runId: string): ModelArtifact {
  const newcomer = audience === "unsubscribed";
  const names = ["pos_b1", "beat_sponsor", "energy", ...(newcomer ? ["mix_search"] : [])];
  return {
    runId,
    channelId: CHANNEL,
    audience,
    modelVersion: MODEL_VERSION,
    featureVersion: FEATURE_VERSION,
    extractionVersion: EXTRACTION_VERSION,
    createdAt: "2026-10-11T09:00:00.000Z",
    featureNames: names,
    droppedFeatures: [],
    unpenalized: ["pos_b1"],
    mean: names.map(() => 0.1),
    sd: names.map(() => 0.3),
    alpha: -4,
    beta: names.map((name) => (name === "beat_sponsor" ? 0.3 : 0)),
    cov: Array.from({ length: names.length + 1 }, (_, i) =>
      Array.from({ length: names.length + 1 }, (_, j) => (i === j ? 0.01 : 0)),
    ),
    lambda: 3,
    priorRef: null,
    trainChannelIds: [CHANNEL],
    trainVideoIds: VIDEOS.map((video) => video.id),
    channelContext: { medianTargetLevel: 2, mixMean: { search: 0.2, suggested: 0.1, browse: 0.5 } },
    usable: false,
    unusableReasons: ["trained on 3 videos; at least 30 are needed"],
    metrics: {
      rows: 300,
      videos: 3,
      trainLoss: 0.05,
      cv: [],
      folds: 3,
      iterations: 10,
      converged: true,
      gradientNorm: 1e-9,
    },
  };
}

const run = (
  runId: string,
  audience: string,
  finishedAt: string,
  extra: Record<string, unknown> = {},
) => ({
  channel_id: CHANNEL,
  run_id: runId,
  audience,
  status: "fitted",
  model_version: MODEL_VERSION,
  feature_version: FEATURE_VERSION,
  finished_at: { value: finishedAt },
  artifact_uri: `gs://test-raw/${CHANNEL}/models/${runId}/${audience}.json`,
  ...extra,
});

async function seed(bigquery: FakeBigQuery, storage: FakeStorage) {
  const details = JSON.stringify({
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
  Object.assign(bigquery.tables, {
    videos: VIDEOS.map(({ id, duration }) => ({
      channel_id: CHANNEL,
      video_id: id,
      duration_s: duration,
      eligible: true,
    })),
    beat_videos: VIDEOS.map(({ id }) => ({
      channel_id: CHANNEL,
      video_id: id,
      extraction_version: EXTRACTION_VERSION,
      format: "tutorial",
      target_level: 2,
      payoff_time_s: null,
    })),
    beats: VIDEOS.map(({ id, duration }) => ({
      channel_id: CHANNEL,
      video_id: id,
      extraction_version: EXTRACTION_VERSION,
      beat_index: 0,
      start_s: 0,
      end_s: duration,
      beat_type: "explanation",
      details,
    })),
    model_runs: [
      run("old", "all", "2026-10-10T09:00:00Z"),
      run("new", "all", "2026-10-11T09:00:00Z"),
      run("new", "unsubscribed", "2026-10-11T09:00:01Z"),
      run("stalled", "subscribed", "2026-10-11T09:00:02Z", {
        status: "not_converged",
        artifact_uri: null,
      }),
      run("other", "subscribed", "2026-10-12T09:00:00Z", { model_version: "hazard-v0" }),
    ],
  });
  const bucket = storage.asStorage().bucket("test-raw");
  for (const [runId, audience] of [
    ["old", "all"],
    ["new", "all"],
    ["new", "unsubscribed"],
  ] as const) {
    await bucket
      .file(`${CHANNEL}/models/${runId}/${audience}.json`)
      .save(JSON.stringify(artifact(audience, runId)));
  }
}

describe("buildTraits", () => {
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;

  beforeEach(async () => {
    ({ bigquery, storage } = await ingestTestbed());
    await seed(bigquery, storage);
  });

  afterEach(resetTestbed);

  it("simulates the latest fitted model of each audience on the median-length training video", async () => {
    const result = await buildTraits({ channelId: CHANNEL, draws: 100, seed: 3 });
    expect(result.video).toEqual({ id: "vidMiddle", durationS: 120, outOf: 3 });
    expect(result.audiences.map((a) => [a.audience, a.runId])).toEqual([
      ["all", "new"],
      ["unsubscribed", "new"],
    ]);
    const all = result.audiences[0];
    expect(all?.traits).toHaveLength(SCENARIOS.length);
    const sponsor = all?.traits.find((trait) => trait.feature === "beat_sponsor");
    expect(sponsor?.measured).toBe(true);
    expect(sponsor?.deltaPp).toBeLessThan(0);
    expect(all?.traits.find((trait) => trait.feature === "beat_cta")?.measured).toBe(false);
    expect(result.estimated.map((e) => [e.source, e.shown])).toEqual([
      ["search", false],
      ["suggested", false],
      ["browse", false],
    ]);
  });

  it("prints a list a person can sanity-read", async () => {
    const text = formatTraits(await buildTraits({ channelId: CHANNEL, draws: 100, seed: 3 }));
    expect(text).toContain(`Traits for ${CHANNEL} (${MODEL_VERSION} on ${FEATURE_VERSION})`);
    expect(text).toContain(
      "Simulated on vidMiddle (120 s), the median length of 3 training videos.",
    );
    expect(text).toContain("with a 90% interval. Associations in past videos, not causes.");
    expect(text).toContain(
      "All viewers (run new; not usable: trained on 3 videos; at least 30 are needed)",
    );
    expect(text).toMatch(/a 30 s sponsor read at 30% {2,}-\d+\.\d pp \(-\d+\.\d to [+-]\d+\.\d\)/);
    expect(text).toContain("not learned: it never varies in the training videos");
    expect(text).toMatch(/search: hidden \(.*trained on 3 videos; at least 30 are needed/);
  });

  it("needs a fitted model first", async () => {
    bigquery.tables.model_runs = [];
    await expect(buildTraits({ channelId: CHANNEL })).rejects.toThrow(/No fitted hazard-v1 models/);
  });
});
