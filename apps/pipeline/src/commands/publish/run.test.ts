import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import {
  servingPaths,
  summaryDocSchema,
  videoDocSchema,
  videoIndexDocSchema,
  type ModelArtifact,
} from "@soundcheck/core/schemas";
import type { FakeBigQuery, FakeFirestore, FakeGenAI, FakeStorage } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { formatPublish } from "./index";
import { publishChannel } from "./run";

const VIDEO = "vidOld12345";
const paths = servingPaths(CHANNEL);
const NOW = new Date("2026-10-11T09:00:00Z");

/** 10 points lost in bin 1, 0.3 a bin, and 3 more in bins 32 to 34. */
function survival(): number[] {
  let still = 1;
  return Array.from(
    { length: 100 },
    (_, i) => (still -= (i === 0 ? 10 : i >= 31 && i <= 33 ? 3.3 : 0.3) / 100),
  );
}

function artifact(audience: "all" | "subscribed" | "unsubscribed"): ModelArtifact {
  const names = ["pos_b1", "beat_sponsor", ...(audience === "unsubscribed" ? ["mix_search"] : [])];
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
    trainVideoIds: [VIDEO],
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

const beat = (index: number, start: number, end: number, type: string) => ({
  channel_id: CHANNEL,
  video_id: VIDEO,
  extraction_version: EXTRACTION_VERSION,
  beat_index: index,
  start_s: start,
  end_s: end,
  beat_type: type,
  details: JSON.stringify({
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
    summary: `The ${type}.`,
  }),
});

async function seed(bigquery: FakeBigQuery, storage: FakeStorage) {
  const curve = survival();
  Object.assign(bigquery.tables, {
    videos: [
      {
        channel_id: CHANNEL,
        video_id: VIDEO,
        title: "Old",
        published_at: { value: "2026-08-01T12:00:00.000Z" },
        duration_s: 200,
        thumbnail_url: null,
        eligible: true,
      },
    ],
    video_stats: [
      ["SUBSCRIBED", 300, 400, 50],
      ["UNSUBSCRIBED", 700, 600, 30],
    ].map(([status, views, minutes, avp]) => ({
      channel_id: CHANNEL,
      video_id: VIDEO,
      subscribed_status: status,
      views,
      estimated_minutes_watched: minutes,
      average_view_percentage: avp,
    })),
    retention_coverage: ["subscribed", "unsubscribed"].map((audience) => ({
      channel_id: CHANNEL,
      video_id: VIDEO,
      audience,
      status: "complete",
    })),
    retention_curves: ["subscribed", "unsubscribed"].flatMap((audience) =>
      curve.map((sMono, i) => ({
        channel_id: CHANNEL,
        video_id: VIDEO,
        audience,
        bin: i + 1,
        s_mono: sMono,
        hazard: 1 - sMono / (i === 0 ? 1 : (curve[i - 1] as number)),
        as_of: { value: "2026-10-03" },
      })),
    ),
    beat_videos: [
      {
        channel_id: CHANNEL,
        video_id: VIDEO,
        extraction_version: EXTRACTION_VERSION,
        format: "tutorial",
        target_level: 2,
        payoff_time_s: null,
      },
    ],
    beats: [beat(0, 0, 60, "hook"), beat(1, 60, 90, "sponsor"), beat(2, 90, 200, "explanation")],
    model_runs: (["all", "subscribed", "unsubscribed"] as const).map((audience) => ({
      channel_id: CHANNEL,
      run_id: "run1",
      audience,
      status: "fitted",
      model_version: MODEL_VERSION,
      feature_version: FEATURE_VERSION,
      finished_at: { value: "2026-10-11T08:00:00Z" },
      artifact_uri: `gs://test-raw/${CHANNEL}/models/run1/${audience}.json`,
    })),
    eval_runs: [],
  });
  const bucket = storage.asStorage().bucket("test-raw");
  for (const audience of ["all", "subscribed", "unsubscribed"] as const) {
    await bucket
      .file(`${CHANNEL}/models/run1/${audience}.json`)
      .save(JSON.stringify(artifact(audience)));
  }
}

/** Gemini's captions, written from each item's facts so they pass the checks. */
function captionFacts(gemini: FakeGenAI) {
  gemini.respondWith((request) => {
    const text = (request.contents as { parts: { text: string }[] }[])[0]?.parts[0]?.text ?? "";
    const items = JSON.parse(text.slice(text.indexOf("["))) as {
      id: string;
      kind: string;
      facts: Record<string, unknown>;
    }[];
    const caption = ({ kind, facts }: (typeof items)[number]) =>
      kind === "drop"
        ? `${String(facts.audience)} left fast from ${String(facts.start)} to ${String(facts.end)}.`
        : kind === "audience"
          ? `${String(facts.audience)} bring ${String(facts.viewSharePercent)}% of your views.`
          : `${String(facts.videosAnalysed)} videos so far.`;
    return {
      text: JSON.stringify({ items: items.map((item) => ({ id: item.id, text: caption(item) })) }),
    };
  });
}

describe("publishChannel", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;
  let gemini: FakeGenAI;

  beforeEach(async () => {
    ({ db, bigquery, storage, gemini } = await ingestTestbed());
    vi.stubEnv("GEMINI_FLASH_MODEL", "flash");
    await seed(bigquery, storage);
    captionFacts(gemini);
  });

  afterEach(resetTestbed);

  const publish = (force = false) =>
    publishChannel({ channelId: CHANNEL, runId: "pub1", now: NOW, log: quiet, draws: 40, force });

  it("writes the summary, the video list and each video's page, each valid", async () => {
    // A page of a video that is no longer published.
    await db.doc(paths.video("gone1234567")).set({ title: "Gone" });
    const result = await publish();
    expect(result).toMatchObject({
      videos: 1,
      templated: 0,
      written: true,
      deleted: 1,
      notUsable: true,
    });
    expect(result.drops).toBeGreaterThan(0);

    const summary = summaryDocSchema.parse(db.docs.get(paths.summary));
    expect(summary).toMatchObject({
      runId: "pub1",
      videosAnalysed: 1,
      beatsExtracted: 3,
      headline: "1 videos so far.",
    });
    expect(summary.audiences.map((card) => card.description)).toEqual([
      "Subscribers bring 30% of your views.",
      "Newcomers bring 70% of your views.",
    ]);
    const index = videoIndexDocSchema.parse(db.docs.get(paths.videoIndex));
    expect(index.videos.map((video) => video.videoId)).toEqual([VIDEO]);
    const page = videoDocSchema.parse(db.docs.get(paths.video(VIDEO)));
    expect(page.drops[0]?.narrative).toMatch(/left fast from \d+:\d\d to \d+:\d\d\./);
    expect(page.drops.some((drop) => drop.attributions[0]?.group === "sponsor")).toBe(true);
    expect(page.beats.map((beat) => beat.transcriptExcerpt)).toEqual([
      "Words.",
      "Words.",
      "Words.",
    ]);
    expect(db.docs.has(paths.video("gone1234567"))).toBe(false);
    expect(db.docs.get(`channels/${CHANNEL}/steps/publish`)).toMatchObject({
      rows: { videos: 1, deleted: 1 },
    });
    expect(formatPublish(result)).toBe(
      `publish: 1 video, ${result.drops} drop-offs, 1 old page removed (written); models not usable: screens must say "not a result yet"`,
    );
  });

  it("writes nothing when the documents would come out the same, and asks Gemini nothing", async () => {
    await publish();
    const calls = gemini.requests.length;
    const commits = db.commits.length;
    const again = await publishChannel({
      channelId: CHANNEL,
      runId: "pub2",
      now: NOW,
      log: quiet,
      draws: 40,
    });
    expect(again.written).toBe(false);
    expect(gemini.requests).toHaveLength(calls);
    expect(db.commits).toHaveLength(commits);
    expect(summaryDocSchema.parse(db.docs.get(paths.summary)).runId).toBe("pub1");
    expect((await publish(true)).written).toBe(true);
  });

  it("writes a large catalogue in batches of at most 500", async () => {
    bigquery.tables.videos = Array.from({ length: 600 }, (_, i) => ({
      channel_id: CHANNEL,
      video_id: `v${String(i).padStart(10, "0")}`,
      title: `Video ${i}`,
      published_at: { value: "2026-08-01T12:00:00.000Z" },
      duration_s: 120,
      thumbnail_url: null,
      eligible: true,
    }));
    const result = await publish();
    expect(result.videos).toBe(600);
    expect(db.commits).toEqual([500, 102]);
  });
});
