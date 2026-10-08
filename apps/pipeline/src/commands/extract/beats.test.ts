import { EXTRACTION_VERSION } from "@soundcheck/core";
import { clockToSeconds } from "@soundcheck/core/schemas";
import type { ExtractionSettings } from "@soundcheck/core/gemini";
import type { FakeBigQuery, FakeFirestore, FakeGenAI, FakeStorage } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_STEP } from "../ingest/catalogue";
import {
  AS_OF,
  CHANNEL,
  NOW,
  fixture,
  ingestTestbed,
  quiet,
  resetTestbed,
  type FakeYoutubeApi,
} from "../ingest/testbed";
import { extractBeats, formatExtraction } from "./beats";
import { loadBeats } from "./load";

const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 0.75, outputPerM: 3.75 },
};

/** A valid answer covering the length the request names ("It lasts 3:42."), in beats of at most 120 s. */
function coveringAnswer(request: Parameters<FakeGenAI["models"]["generateContent"]>[0]) {
  const contents = request.contents as Array<{ parts: Array<{ text?: string }> }>;
  const text = contents[0]?.parts.find((part) => part.text)?.text ?? "";
  const lasts = /It lasts (\d+:\d{2})\./.exec(text)?.[1] ?? "1:00";
  const duration = clockToSeconds(lasts);
  const clock = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const beats = [];
  for (let start = 0; start < duration; start += 120) {
    beats.push({
      start: clock(start),
      end: clock(Math.min(start + 120, duration)),
      beat_type: "performance",
      framing: "talking_head_static",
      cuts_per_min: 0,
      on_screen_text: false,
      music: "foreground",
      energy: 2,
      assumed_knowledge: 1,
      info_density: 1,
      opens_loop: null,
      closes_loop: false,
      speaker_count: 1,
      transcript: "la la la",
      summary: "He sings.",
    });
  }
  return {
    text: JSON.stringify({
      schema_version: "beats-v1",
      video_summary: "A performance.",
      format: "performance",
      title_promise: "A song.",
      target_level: 1,
      payoff_time: null,
      beats,
    }),
  };
}

const catalogue = (videoId: string, eligible: boolean) => ({
  channel_id: CHANNEL,
  video_id: videoId,
  published_at: "2026-09-28T14:00:00Z",
  eligible,
});

describe("extract beats", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;
  let gemini: FakeGenAI;
  let api: FakeYoutubeApi;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];
  let archived: (path: string) => unknown;

  beforeEach(async () => {
    ({ db, bigquery, storage, gemini, api, connect, archived } = await ingestTestbed());
    // fixtureVid1 (88 s), fixtureVid3 (222 s) and fixtureVid4 (262 s) are eligible; the Short is not.
    bigquery.tables.videos = [
      catalogue("fixtureVid1", true),
      catalogue("fixtureVid2", false),
      catalogue("fixtureVid3", true),
      catalogue("fixtureVid4", true),
    ];
    await db
      .collection(`channels/${CHANNEL}/steps`)
      .doc(CATALOGUE_STEP)
      .set({ asOf: AS_OF, version: "ingest-v1", rows: { videos: 4 }, finishedAt: NOW });
    gemini.respondWith(coveringAnswer);
  });

  afterEach(resetTestbed);

  const extract = (
    options: {
      video?: string;
      limit?: number;
      noCache?: boolean;
      task?: { index: number; count: number };
    } = {},
  ) =>
    extractBeats({
      channelId: CHANNEL,
      settings,
      log: quiet,
      connect,
      now: NOW,
      task: { index: 0, count: 1 },
      ...options,
    });

  it("extracts every eligible video once and loads the beat tables", async () => {
    const result = await extract();
    expect(result.outcomes.map((o) => [o.videoId, o.status]).sort()).toEqual([
      ["fixtureVid1", "extracted"],
      ["fixtureVid3", "extracted"],
      ["fixtureVid4", "extracted"],
    ]);
    expect(gemini.requests).toHaveLength(3);
    expect(result.loaded).toBe(true);

    const beatVideos = bigquery.tables.beat_videos ?? [];
    expect(beatVideos.map((row) => [row.video_id, row.beat_count, row.coverage]).sort()).toEqual([
      ["fixtureVid1", 1, 1],
      ["fixtureVid3", 2, 1],
      ["fixtureVid4", 3, 1],
    ]);
    expect(bigquery.tables.beats).toHaveLength(6);
    expect(bigquery.tables.beats?.[0]).toMatchObject({
      channel_id: CHANNEL,
      extraction_version: EXTRACTION_VERSION,
      beat_type: "performance",
      details: expect.objectContaining({
        framing: "talking_head_static",
        words_per_minute: expect.any(Number),
      }),
    });
    const runs = bigquery.tables.extraction_runs ?? [];
    expect(runs).toHaveLength(3);
    expect(runs[0]).toMatchObject({
      run_id: result.runId,
      status: "extracted",
      gemini_model: "test-model",
      details: expect.objectContaining({
        calls: expect.any(Array),
        prompt_tokens: 8_000,
        cost_usd: expect.any(Number),
      }),
    });
  });

  it("costs nothing on a re-run: every video comes from the cache", async () => {
    await extract();
    const second = await extract();
    expect(second.outcomes.map((o) => o.status)).toEqual(["cached", "cached", "cached"]);
    expect(second.outcomes.every((o) => o.usage.prompt_tokens === 0)).toBe(true);
    expect(gemini.requests).toHaveLength(3);
    expect(bigquery.tables.extraction_runs).toHaveLength(6);
    expect(bigquery.tables.beats).toHaveLength(6);
  });

  it("archives the Data API response it took durations from", async () => {
    await extract();
    expect(archived("youtube-videos/extract-batch-001")).toEqual(
      fixture("videos.list.uploads.json"),
    );
    expect(api.videos.mock.calls[0]?.[0].id).toEqual(["fixtureVid1", "fixtureVid3", "fixtureVid4"]);
  });

  it("extracts one catalogue video with --video, even an ineligible one", async () => {
    const result = await extract({ video: "fixtureVid2" });
    expect(result.outcomes.map((o) => [o.videoId, o.status])).toEqual([
      ["fixtureVid2", "extracted"],
    ]);
    expect(bigquery.tables.beat_videos?.map((row) => row.video_id)).toEqual(["fixtureVid2"]);
  });

  it("refuses a video outside the catalogue, and runs before the catalogue", async () => {
    await expect(extract({ video: "notMine" })).rejects.toThrow(/not in .*catalogue/);
    db.docs.delete(`channels/${CHANNEL}/steps/${CATALOGUE_STEP}`);
    await expect(extract()).rejects.toThrow(/run "ingest catalogue" first/);
    expect(gemini.requests).toHaveLength(0);
  });

  it("limits the run with --limit", async () => {
    const result = await extract({ limit: 1 });
    expect(result.outcomes).toHaveLength(1);
  });

  it("shards videos across tasks and leaves loading to extract load", async () => {
    const result = await extract({ task: { index: 1, count: 2 } });
    expect(result.outcomes.map((o) => o.videoId)).toEqual(["fixtureVid3", "fixtureVid4"]);
    expect(result.loaded).toBe(false);
    expect(bigquery.tables.beats).toEqual([]);

    expect(await loadBeats(CHANNEL, { settings, log: quiet })).toEqual({
      videos: 2,
      beats: 5,
      runs: 2,
    });
    expect(bigquery.tables.beats).toHaveLength(5);
  });

  it("marks a private video without asking Gemini", async () => {
    const list = fixture("videos.list.uploads.json") as {
      items: Array<{ id: string; status: Record<string, unknown> }>;
    };
    for (const item of list.items)
      if (item.id === "fixtureVid3") item.status.privacyStatus = "private";
    api.videos.mockResolvedValueOnce(list);
    const result = await extract();
    expect(result.outcomes.find((o) => o.videoId === "fixtureVid3")?.status).toBe(
      "private_unavailable",
    );
    expect(gemini.requests).toHaveLength(2);
    expect(
      bigquery.tables.extraction_runs?.find((row) => row.video_id === "fixtureVid3")?.status,
    ).toBe("private_unavailable");
  });

  it("loads only extractions made with the current settings", async () => {
    await extract();
    const agentic = { ...settings, videoMode: "agentic" as const };
    expect(await loadBeats(CHANNEL, { settings: agentic, log: quiet })).toMatchObject({
      videos: 0,
      beats: 0,
    });
  });

  it("keeps run records and cached beats under the channel in the raw bucket", async () => {
    await extract();
    const names = [...(storage.buckets["test-raw"] ?? [])];
    expect(names.filter((name) => name.startsWith(`${CHANNEL}/beats/`))).toHaveLength(3);
    expect(names.filter((name) => name.startsWith(`${CHANNEL}/extraction-runs/`))).toHaveLength(3);
    expect(names.every((name) => name.startsWith(`${CHANNEL}/`))).toBe(true);
  });
});

describe("formatExtraction", () => {
  it("prints each video and the totals, with cost per minute of video read", async () => {
    const testbed = await ingestTestbed();
    testbed.bigquery.tables.videos = [catalogue("fixtureVid1", true)];
    await testbed.db
      .collection(`channels/${CHANNEL}/steps`)
      .doc(CATALOGUE_STEP)
      .set({ asOf: AS_OF, version: "ingest-v1", rows: {}, finishedAt: NOW });
    testbed.gemini.respondWith(coveringAnswer);
    const result = await extractBeats({
      channelId: CHANNEL,
      settings,
      log: quiet,
      connect: testbed.connect,
      task: { index: 0, count: 1 },
    });
    const text = formatExtraction(result);
    expect(text).toContain("(test-model, static)");
    expect(text).toMatch(/fixtureVid1\s+extracted\s+1\s+100%\s+8000\s+1000\s+\$0\.0097/);
    // 8,000 in at $0.75 and 1,000 out at $3.75 per million: $0.00975 for 88 s (shown as $0.0097), $0.0066 a minute.
    expect(text).toMatch(
      /1 videos: 1 extracted; 8000 tokens in, 1000 out; cost \$0\.0097; \$0\.0066 per minute/,
    );
    resetTestbed();
  });
});
