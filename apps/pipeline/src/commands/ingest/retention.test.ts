import type { AnalyticsQuery } from "@soundcheck/core/youtube";
import type { FakeBigQuery, FakeFirestore } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CATALOGUE_STEP } from "./catalogue";
import { MIX_STEP } from "./mix";
import {
  RETENTION_STEP,
  formatCoverage,
  ingestRetention,
  median,
  type CoverageSummary,
} from "./retention";
import { STATS_STEP } from "./stats";
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

const VIDEOS = [
  { id: "vidA", publishedAt: "2022-05-08T16:00:26Z", views: [100, 200] },
  // Ads bring 10 of 300 views: 3.3%, so its organic audience is measured.
  { id: "vidB", publishedAt: "2022-05-31T12:32:43Z", views: [50, 250], ads: 10 },
  // 05:00 UTC is still the previous day in California.
  { id: "vidC", publishedAt: "2023-03-26T05:00:00Z", views: [40, 300] },
];

const isSegments = (query: AnalyticsQuery) => query.metrics.includes("startedWatching");
const curveCalls = (api: FakeYoutubeApi) =>
  api.report.mock.calls.map(([query]) => query).filter((query) => !isSegments(query));

describe("ingestRetention", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let api: FakeYoutubeApi;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];
  let archived: (path: string) => unknown;

  beforeEach(async () => {
    ({ db, bigquery, api, connect, archived } = await ingestTestbed());
    bigquery.tables.videos = [
      ...VIDEOS.map((video) => ({
        channel_id: CHANNEL,
        video_id: video.id,
        published_at: video.publishedAt,
        eligible: true,
      })),
      {
        channel_id: CHANNEL,
        video_id: "short",
        published_at: "2024-01-01T00:00:00Z",
        eligible: false,
      },
    ];
    bigquery.tables.video_stats = VIDEOS.flatMap((video) =>
      ["SUBSCRIBED", "UNSUBSCRIBED"].map((status, i) => ({
        channel_id: CHANNEL,
        video_id: video.id,
        subscribed_status: status,
        views: video.views[i],
      })),
    );
    bigquery.tables.video_traffic_mix = VIDEOS.filter((video) => video.ads).map((video) => ({
      channel_id: CHANNEL,
      video_id: video.id,
      subscribed_status: "UNSUBSCRIBED",
      raw_type: "ADVERTISING",
      views: video.ads,
    }));
    for (const step of [CATALOGUE_STEP, STATS_STEP, MIX_STEP]) {
      await db
        .collection(`channels/${CHANNEL}/steps`)
        .doc(step)
        .set({ asOf: AS_OF, version: "ingest-v1", rows: {}, finishedAt: NOW });
    }
  });

  afterEach(resetTestbed);

  const ingest = (options: { force?: boolean } = {}) =>
    ingestRetention({ channelId: CHANNEL, now: NOW, log: quiet, connect, ...options });

  it("measures all, subscribed and unsubscribed, and organic only where ads pass 2%", async () => {
    await ingest();
    const calls = curveCalls(api);
    expect(calls).toHaveLength(10);
    expect(
      calls.filter((query) => query.filters?.includes("ORGANIC")).map((q) => q.filters),
    ).toEqual(["video==vidB;audienceType==ORGANIC"]);
    // One video per call, from its own publish date (Pacific) to the data date.
    expect(calls.find((query) => query.filters === "video==vidC")).toEqual({
      startDate: "2023-03-25",
      endDate: AS_OF,
      dimensions: "elapsedVideoTimeRatio",
      metrics: "audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions",
      filters: "video==vidC",
    });
  });

  it("stores 100 rows per curve with monotone survival and hazards", async () => {
    await ingest();
    const curves = bigquery.tables.retention_curves ?? [];
    expect(curves).toHaveLength(1_000);
    const vidA = curves.filter((row) => row.video_id === "vidA" && row.audience === "all");
    expect(vidA.map((row) => row.bin)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    for (const row of curves) {
      expect(Number(row.s_mono)).toBeLessThanOrEqual(1);
      expect(Number(row.hazard)).toBeGreaterThanOrEqual(0);
    }
  });

  it("writes a coverage row for every video and audience, including skipped ones", async () => {
    await ingest();
    const coverage = bigquery.tables.retention_coverage ?? [];
    expect(coverage).toHaveLength(12);
    expect(coverage.filter((row) => row.status === "complete")).toHaveLength(10);
    expect(
      coverage.find((row) => row.video_id === "vidA" && row.audience === "organic"),
    ).toMatchObject({
      status: "skipped",
      points: 0,
      details: { reason: "ad views 0.0% of views, not above 2%" },
    });
    expect(
      coverage.find((row) => row.video_id === "vidB" && row.audience === "subscribed"),
    ).toMatchObject({ status: "complete", points: 100, details: { segment_counts: "empty" } });
  });

  it("records too little data without asking for segment counts", async () => {
    api.report.mockImplementation(async (query) =>
      query.filters === "video==vidC;subscribedStatus==SUBSCRIBED"
        ? {
            columnHeaders: [
              { name: "elapsedVideoTimeRatio", columnType: "DIMENSION", dataType: "FLOAT" },
            ],
          }
        : fixture(
            isSegments(query)
              ? "reports.query.retention-segments.json"
              : "reports.query.retention.all.json",
          ),
    );
    const result = await ingest();
    expect(
      result?.coverage.find((row) => row.video_id === "vidC" && row.audience === "subscribed"),
    ).toMatchObject({
      status: "insufficient_data",
      points: 0,
      details: { segment_counts: "not_requested" },
    });
    const segmentFilters = api.report.mock.calls
      .map(([query]) => query)
      .filter(isSegments)
      .map((query) => query.filters);
    expect(segmentFilters).not.toContain("video==vidC;subscribedStatus==SUBSCRIBED");
    expect(result?.summary.completeVideos).toBe(2);
  });

  it("keeps the curve and records the reason when segment counts fail", async () => {
    const fallback = api.report.getMockImplementation();
    api.report.mockImplementation(async (query, options) => {
      if (isSegments(query)) {
        throw Object.assign(new Error("Request failed"), {
          response: {
            status: 500,
            data: { error: { message: "An internal error has occurred." } },
          },
        });
      }
      return fallback?.(query, options);
    });
    const result = await ingest();
    expect(result?.curves).toHaveLength(1_000);
    expect(result?.coverage.find((row) => row.status === "complete")?.details).toEqual({
      segment_counts: "error",
      segment_error: "HTTP 500: An internal error has occurred.",
    });
    // Segment counts are optional: two attempts, not six.
    const segmentOptions = api.report.mock.calls.filter(([query]) => isSegments(query));
    expect(segmentOptions.every(([, options]) => options?.maxAttempts === 2)).toBe(true);
    expect(result?.summary.segmentCounts).toMatchObject({ error: 10, available: 0 });
  });

  it("fails the step when a curve cannot be fetched", async () => {
    api.report.mockRejectedValue(Object.assign(new Error("quota"), { response: { status: 403 } }));
    await expect(ingest()).rejects.toThrow("quota");
    expect(db.docs.has(`channels/${CHANNEL}/steps/${RETENTION_STEP}`)).toBe(false);
    expect(bigquery.tables.retention_curves).toEqual([]);
  });

  it("runs at most five calls at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    const fallback = api.report.getMockImplementation();
    api.report.mockImplementation(async (query, options) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 2));
      inFlight -= 1;
      return fallback?.(query, options);
    });
    await ingest();
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it("archives every raw curve, keyed by video and audience", async () => {
    await ingest();
    expect(archived("analytics-retention/vidB-organic")).toBeDefined();
    expect(archived("analytics-retention-segments/vidA-all")).toBeDefined();
  });

  it("summarizes coverage for the report", async () => {
    const result = await ingest();
    expect(result?.summary).toEqual({
      channelId: CHANNEL,
      asOf: AS_OF,
      eligibleVideos: 3,
      completeVideos: 3,
      medianViews: 300,
      analyticsQueries: 20,
      usable: false,
      byAudience: {
        all: { complete: 3, partial: 0, insufficient_data: 0, skipped: 0 },
        subscribed: { complete: 3, partial: 0, insufficient_data: 0, skipped: 0 },
        unsubscribed: { complete: 3, partial: 0, insufficient_data: 0, skipped: 0 },
        organic: { complete: 1, partial: 0, insufficient_data: 0, skipped: 2 },
      },
      segmentCounts: { available: 0, empty: 10, error: 0, not_requested: 0 },
    });
    expect(db.docs.get(`channels/${CHANNEL}/steps/${RETENTION_STEP}`)).toMatchObject({
      rows: { retention_curves: 1_000, retention_coverage: 12 },
    });
  });

  it("replaces the channel's rows on a forced re-run, and skips otherwise", async () => {
    await ingest();
    await expect(ingest()).resolves.toBeUndefined();
    await ingest({ force: true });
    expect(bigquery.tables.retention_curves).toHaveLength(1_000);
    expect(bigquery.tables.retention_coverage).toHaveLength(12);
  });

  it.each([
    [STATS_STEP, "stats"],
    [MIX_STEP, "mix"],
    [CATALOGUE_STEP, "catalogue"],
  ])("refuses to run before %s", async (step, command) => {
    db.docs.delete(`channels/${CHANNEL}/steps/${step}`);
    await expect(ingest()).rejects.toThrow(`run "ingest ${command}" first`);
    expect(api.report).not.toHaveBeenCalled();
  });
});

describe("median", () => {
  it("handles odd, even and empty lists", () => {
    expect(median([300, 100, 200])).toBe(200);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("formatCoverage", () => {
  const summary: CoverageSummary = {
    channelId: CHANNEL,
    asOf: AS_OF,
    eligibleVideos: 3,
    completeVideos: 3,
    medianViews: 314,
    analyticsQueries: 18,
    usable: false,
    byAudience: {
      all: { complete: 3, partial: 0, insufficient_data: 0, skipped: 0 },
      subscribed: { complete: 3, partial: 0, insufficient_data: 0, skipped: 0 },
      unsubscribed: { complete: 2, partial: 1, insufficient_data: 0, skipped: 0 },
      organic: { complete: 0, partial: 0, insufficient_data: 0, skipped: 3 },
    },
    segmentCounts: { available: 0, empty: 9, error: 0, not_requested: 0 },
  };

  it("prints the spec's coverage figures and the modeling verdict", () => {
    const text = formatCoverage(summary);
    expect(text).toContain(`Retention coverage for ${CHANNEL} (data through ${AS_OF})`);
    expect(text).toMatch(/Eligible videos\s+3/);
    expect(text).toMatch(/Complete subscribed and unsubscribed curves\s+3/);
    expect(text).toMatch(/Median views per eligible video\s+314/);
    expect(text).toMatch(/Analytics calls\s+18/);
    expect(text).toMatch(/Usable for modeling \(40\+ complete videos\)\s+no \(3 of 40\)/);
    expect(text).toMatch(/unsubscribed\s+2\s+1\s+0\s+0/);
    expect(text).toContain("for 9 curves: 0 available, 9 empty, 0 errors, 0 not requested");
  });

  it("says yes for a usable channel", () => {
    expect(formatCoverage({ ...summary, usable: true, completeVideos: 41 })).toMatch(
      /Usable for modeling \(40\+ complete videos\)\s+yes/,
    );
  });
});
