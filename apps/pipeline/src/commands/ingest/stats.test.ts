import type { FakeBigQuery, FakeFirestore } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_STEP } from "./catalogue";
import { STATS_STEP, ingestStats } from "./stats";
import {
  AS_OF,
  CHANNEL,
  NOW,
  fixture,
  ingestTestbed,
  quiet,
  resetTestbed,
  type FakeYoutubeApi,
} from "./testbed";

const video = (video_id: string, published_at: string, eligible = true) => ({
  channel_id: CHANNEL,
  video_id,
  published_at,
  eligible,
});

describe("ingestStats", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let api: FakeYoutubeApi;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];
  let archived: (path: string) => unknown;

  beforeEach(async () => {
    ({ db, bigquery, api, connect, archived } = await ingestTestbed());
    // What `ingest catalogue` left: four eligible videos and one excluded.
    bigquery.tables.videos = [
      video("fixtureVid4", "2022-05-08T16:00:26Z"),
      video("fixtureVid3", "2022-05-31T12:32:43Z"),
      video("fixtureVid2", "2022-06-12T12:58:30Z"),
      video("fixtureVid1", "2023-03-26T07:49:18Z"),
      video("tooShort", "2024-01-01T10:00:00Z", false),
    ];
    await db
      .collection(`channels/${CHANNEL}/steps`)
      .doc(CATALOGUE_STEP)
      .set({ asOf: AS_OF, version: "ingest-v1", rows: { videos: 5 }, finishedAt: NOW });
  });

  afterEach(resetTestbed);

  const ingest = (options: { force?: boolean } = {}) =>
    ingestStats({ channelId: CHANNEL, now: NOW, log: quiet, connect, ...options });

  it("queries the eligible videos from the oldest one's publish date", async () => {
    await ingest();
    expect(api.report).toHaveBeenCalledExactlyOnceWith({
      startDate: "2022-05-08",
      endDate: AS_OF,
      dimensions: "video,subscribedStatus",
      metrics:
        "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      filters: "video==fixtureVid4,fixtureVid3,fixtureVid2,fixtureVid1",
    });
  });

  it("writes a subscribed and an unsubscribed row for every eligible video", async () => {
    await ingest();
    const rows = bigquery.tables.video_stats ?? [];
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((row) => `${row.video_id} ${row.subscribed_status}`)).size).toBe(8);
    expect(rows.every((row) => row.channel_id === CHANNEL && row.as_of === AS_OF)).toBe(true);
    expect(rows.find((row) => row.video_id === "tooShort")).toBeUndefined();
  });

  it("archives the raw report and records the step", async () => {
    await ingest();
    expect(archived("analytics-stats/batch-001")).toEqual(fixture("reports.query.stats.json"));
    expect(db.docs.get(`channels/${CHANNEL}/steps/${STATS_STEP}`)).toMatchObject({
      asOf: AS_OF,
      rows: { video_stats: 8 },
    });
  });

  it("writes zero-view rows for videos Analytics has no data for", async () => {
    bigquery.tables.videos = [video("quiet", "2026-09-01T10:00:00Z")];
    api.report.mockResolvedValueOnce({
      columnHeaders: fixture("reports.query.stats.json").columnHeaders as unknown[],
    });
    await ingest();
    expect(bigquery.tables.video_stats).toEqual([
      expect.objectContaining({ video_id: "quiet", subscribed_status: "SUBSCRIBED", views: 0 }),
      expect.objectContaining({ video_id: "quiet", subscribed_status: "UNSUBSCRIBED", views: 0 }),
    ]);
  });

  it("replaces the channel's rows on a forced re-run, and skips otherwise", async () => {
    await ingest();
    await expect(ingest()).resolves.toBeUndefined();
    await ingest({ force: true });
    expect(bigquery.tables.video_stats).toHaveLength(8);
    expect(api.report).toHaveBeenCalledTimes(2);
  });

  it("refuses to run before the catalogue", async () => {
    db.docs.delete(`channels/${CHANNEL}/steps/${CATALOGUE_STEP}`);
    await expect(ingest()).rejects.toThrow(/run "ingest catalogue" first/);
    expect(api.report).not.toHaveBeenCalled();
  });
});
