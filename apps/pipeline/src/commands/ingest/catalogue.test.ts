import { readFileSync } from "node:fs";
import { createLogger, resetClients, resetEnvCache, setClientOverride } from "@soundcheck/core";
import type { ChannelDoc } from "@soundcheck/core/schemas";
import { FakeBigQuery, FakeFirestore, FakeStorage, memoryLogger } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CATALOGUE_STEP, ingestCatalogue } from "./catalogue";
import type { YoutubeApi } from "./run";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const NOW = new Date("2026-10-06T12:00:00Z");
const quiet = createLogger({ level: "silent" });
const VIDEO_COLUMNS = [
  "channel_id",
  "video_id",
  "title",
  "description",
  "published_at",
  "duration_s",
  "content_type",
  "is_live",
  "category_id",
  "tags",
  "thumbnail_url",
  "default_language",
  "eligible",
  "exclusion_reason",
  "ingested_at",
];

const fixture = (name: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`../../../../../tests/fixtures/youtube/${name}`, import.meta.url), "utf8"),
  ) as Record<string, unknown>;

describe("ingestCatalogue", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;
  let api: { [K in keyof YoutubeApi]: ReturnType<typeof vi.fn<YoutubeApi[K]>> };
  const connect = vi.fn(async () => api as YoutubeApi);

  beforeEach(async () => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv("BQ_DATASET", "soundcheck");
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    db = new FakeFirestore();
    storage = new FakeStorage();
    bigquery = new FakeBigQuery({ videos: [] }, { columns: { videos: VIDEO_COLUMNS }, storage });
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("bigquery", bigquery.asBigQuery());
    setClientOverride("storage", storage.asStorage());

    const channel: ChannelDoc = {
      userId: "111111111111111111111",
      title: "Fixture Channel",
      thumbnailUrl: null,
      subscriberCount: 8450,
      videoCount: 4,
      uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
      status: "connected",
      tokenCiphertext: "eA==",
      tokenScope: "openid",
      connectedAt: new Date("2026-10-01T10:00:00Z"),
      build: { state: "running" },
    };
    await db.collection("channels").doc(CHANNEL).set(channel);

    api = {
      uploadsPage: vi.fn(async () => fixture("playlistItems.list.uploads.json")),
      videos: vi.fn(async () => fixture("videos.list.uploads.json")),
      report: vi.fn(async () => fixture("reports.query.content-type.json")),
    };
    connect.mockClear();
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const ingest = (options: { force?: boolean } = {}) =>
    ingestCatalogue({ channelId: CHANNEL, now: NOW, log: quiet, connect, ...options });

  it("writes every upload with its content type and eligibility", async () => {
    await ingest();
    const rows = bigquery.tables.videos ?? [];
    expect(
      rows.map((row) => [row.video_id, row.content_type, row.duration_s, row.exclusion_reason]),
    ).toEqual([
      ["fixtureVid1", "VIDEO_ON_DEMAND", 88, null],
      ["fixtureVid2", "SHORTS", 31, "too_short"],
      ["fixtureVid3", "VIDEO_ON_DEMAND", 222, null],
      ["fixtureVid4", "VIDEO_ON_DEMAND", 262, null],
    ]);
    expect(rows[2]).toEqual({
      channel_id: CHANNEL,
      video_id: "fixtureVid3",
      title: "Fixture video 3",
      description: "",
      published_at: "2026-09-28T14:00:00Z",
      duration_s: 222,
      content_type: "VIDEO_ON_DEMAND",
      is_live: false,
      category_id: expect.any(String),
      tags: [],
      thumbnail_url: "https://i.ytimg.com/vi/fixtureVid3/default.jpg",
      default_language: "en",
      eligible: true,
      exclusion_reason: null,
      ingested_at: "2026-10-06T12:00:00.000Z",
    });
  });

  it("asks Analytics for content types from the oldest publish date to three days ago", async () => {
    await ingest();
    expect(api.report).toHaveBeenCalledExactlyOnceWith({
      startDate: "2026-09-28",
      endDate: "2026-10-03",
      dimensions: "video,creatorContentType",
      metrics: "views",
      filters: "video==fixtureVid1,fixtureVid2,fixtureVid3,fixtureVid4",
    });
  });

  it("archives every raw response, dated by fetch day", async () => {
    await ingest();
    const archived = (path: string) =>
      JSON.parse(
        storage.read(`gs://test-raw/${CHANNEL}/${path}/20261006.json`) ?? "null",
      ) as unknown;
    expect(archived("youtube-playlist-items/page-001")).toEqual(
      fixture("playlistItems.list.uploads.json"),
    );
    expect(archived("youtube-videos/batch-001")).toEqual(fixture("videos.list.uploads.json"));
    expect(archived("analytics-content-type/batch-001")).toEqual(
      fixture("reports.query.content-type.json"),
    );
    // Staging files are gone; only the three raw responses remain.
    expect(storage.buckets["test-raw"]?.size).toBe(3);
  });

  it("archives a response even when it fails to parse", async () => {
    const broken = fixture("videos.list.uploads.json");
    (broken.items as Array<{ contentDetails: { duration: string } }>)[0]!.contentDetails.duration =
      "P1M";
    api.videos.mockResolvedValueOnce(broken);
    await expect(ingest()).rejects.toThrow(RangeError);
    expect(storage.read(`gs://test-raw/${CHANNEL}/youtube-videos/batch-001/20261006.json`)).toBe(
      JSON.stringify(broken),
    );
    expect(bigquery.tables.videos).toEqual([]);
  });

  it("follows the uploads playlist across pages", async () => {
    const page = fixture("playlistItems.list.uploads.json");
    const items = page.items as unknown[];
    api.uploadsPage
      .mockResolvedValueOnce({ ...page, items: items.slice(0, 2), nextPageToken: "EAAaBlBUOkNBSQ" })
      .mockResolvedValueOnce({ ...page, items: items.slice(2) });
    await ingest();
    expect(api.uploadsPage.mock.calls.map(([request]) => request.pageToken)).toEqual([
      undefined,
      "EAAaBlBUOkNBSQ",
    ]);
    expect(api.videos.mock.calls[0]?.[0].id).toEqual([
      "fixtureVid1",
      "fixtureVid2",
      "fixtureVid3",
      "fixtureVid4",
    ]);
    expect(
      storage.read(`gs://test-raw/${CHANNEL}/youtube-playlist-items/page-002/20261006.json`),
    ).toBeDefined();
  });

  it("records progress and the finished step, and logs API usage", async () => {
    const { lines, logger } = memoryLogger();
    await ingestCatalogue({ channelId: CHANNEL, now: NOW, log: logger, connect });

    expect(db.docs.get(`channels/${CHANNEL}`)?.build).toMatchObject({
      state: "running",
      progress: { stage: "ingest", done: 2, total: 2 },
    });
    expect(db.docs.get(`channels/${CHANNEL}/steps/${CATALOGUE_STEP}`)).toMatchObject({
      asOf: "2026-10-03",
      version: "ingest-v1",
      rows: { videos: 4 },
    });
    expect(lines.at(-1)).toMatchObject({
      message: "ingest-catalogue finished",
      channel_id: CHANNEL,
      stage: CATALOGUE_STEP,
      run_id: expect.stringMatching(/^[0-9a-f]{32}$/),
      videos: 4,
      eligible: 3,
      excluded: { too_short: 1 },
      data_api_units: 2,
      analytics_queries: 1,
    });
  });

  it("skips a step already done for this data date, unless forced", async () => {
    await ingest();
    await expect(ingest()).resolves.toBeUndefined();
    expect(connect).toHaveBeenCalledTimes(1);

    await expect(ingest({ force: true })).resolves.toHaveLength(4);
    expect(connect).toHaveBeenCalledTimes(2);
    expect(bigquery.tables.videos).toHaveLength(4);
  });

  it("applies MIN_VIEWS from the environment", async () => {
    vi.stubEnv("MIN_VIEWS", "2000000");
    const rows = await ingest();
    expect(rows?.filter((row) => row.eligible)).toEqual([]);
    expect(rows?.map((row) => row.exclusion_reason)).toEqual([
      "too_few_views",
      "too_short",
      "too_few_views",
      "too_few_views",
    ]);
  });
});
