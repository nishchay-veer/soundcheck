import type { FakeBigQuery, FakeFirestore } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_STEP } from "./catalogue";
import { MIX_STEP, ingestMix } from "./mix";
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

/** Sum of shares per video and subscribed status. */
function shareSums(rows: Array<Record<string, unknown>>): Map<string, number> {
  const sums = new Map<string, number>();
  for (const row of rows) {
    const key = `${String(row.video_id)} ${String(row.subscribed_status)}`;
    sums.set(key, (sums.get(key) ?? 0) + Number(row.share));
  }
  return sums;
}

describe("ingestMix", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let api: FakeYoutubeApi;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];
  let archived: (path: string) => unknown;

  beforeEach(async () => {
    ({ db, bigquery, api, connect, archived } = await ingestTestbed());
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
    ingestMix({ channelId: CHANNEL, now: NOW, log: quiet, connect, ...options });

  it("queries traffic and devices for the eligible videos", async () => {
    await ingest();
    expect(api.report.mock.calls.map(([query]) => [query.dimensions, query.filters])).toEqual([
      [
        "video,insightTrafficSourceType,subscribedStatus",
        "video==fixtureVid4,fixtureVid3,fixtureVid2,fixtureVid1",
      ],
      [
        "video,deviceType,subscribedStatus",
        "video==fixtureVid4,fixtureVid3,fixtureVid2,fixtureVid1",
      ],
    ]);
  });

  it("keeps traffic batches within 50,000 videos × days", async () => {
    // From 2005 a traffic range covers ~7,900 days: 6 videos per query.
    bigquery.tables.videos = Array.from({ length: 13 }, (_, n) =>
      video(`old${String(n).padStart(2, "0")}`, `2005-0${(n % 9) + 1}-01T12:00:00Z`),
    );
    // Empty reports: this test is about the queries, not the rows.
    api.report.mockResolvedValue({
      columnHeaders: fixture("reports.query.device.json").columnHeaders,
    });
    await ingest();
    const traffic = api.report.mock.calls
      .map(([query]) => query)
      .filter((query) => query.dimensions?.includes("insightTrafficSourceType"));
    for (const query of traffic) {
      const videos = (query.filters ?? "").replace("video==", "").split(",").length;
      const days = (Date.parse(query.endDate) - Date.parse(query.startDate)) / 86_400_000 + 1;
      expect(videos * days).toBeLessThanOrEqual(50_000);
    }
    expect(traffic.length).toBeGreaterThan(1);
  });

  it("writes mix rows whose shares sum to 1 per video and subscribed status", async () => {
    await ingest();
    for (const table of ["video_traffic_mix", "video_device_mix"]) {
      const rows = bigquery.tables[table] ?? [];
      const sums = shareSums(rows);
      expect(sums.size).toBe(8);
      for (const sum of sums.values()) expect(Math.abs(sum - 1)).toBeLessThan(0.01);
      expect(rows.every((row) => row.channel_id === CHANNEL && row.as_of === AS_OF)).toBe(true);
    }
  });

  it("archives both raw reports and records the step", async () => {
    await ingest();
    expect(archived("analytics-traffic/batch-001")).toEqual(fixture("reports.query.traffic.json"));
    expect(archived("analytics-device/batch-001")).toEqual(fixture("reports.query.device.json"));
    expect(db.docs.get(`channels/${CHANNEL}/steps/${MIX_STEP}`)).toMatchObject({
      asOf: AS_OF,
      rows: {
        video_traffic_mix: bigquery.tables.video_traffic_mix?.length,
        video_device_mix: bigquery.tables.video_device_mix?.length,
      },
    });
  });

  it("replaces the channel's rows on a forced re-run, and skips otherwise", async () => {
    await ingest();
    const counts = [
      bigquery.tables.video_traffic_mix?.length,
      bigquery.tables.video_device_mix?.length,
    ];
    await expect(ingest()).resolves.toBeUndefined();
    await ingest({ force: true });
    expect([
      bigquery.tables.video_traffic_mix?.length,
      bigquery.tables.video_device_mix?.length,
    ]).toEqual(counts);
  });

  it("refuses to run before the catalogue", async () => {
    db.docs.delete(`channels/${CHANNEL}/steps/${CATALOGUE_STEP}`);
    await expect(ingest()).rejects.toThrow(/run "ingest catalogue" first/);
  });
});
