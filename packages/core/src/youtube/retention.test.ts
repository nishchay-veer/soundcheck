import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  SEGMENT_METRICS,
  curveRows,
  parseRetentionPoints,
  parseSegmentCounts,
  retentionQuery,
  skippedCoverageRow,
  type RetentionPoint,
} from "./retention";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/youtube/${name}`, import.meta.url), "utf8"),
  );

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const context = {
  channelId: CHANNEL,
  videoId: "fixtureVid4",
  audience: "all" as const,
  asOf: "2026-10-03",
};
const request = { videoId: "v1", startDate: "2022-05-08", endDate: "2026-10-03" };

const segmentHeaders = ["elapsedVideoTimeRatio", "startedWatching", "stoppedWatching"].map(
  (name, i) => ({
    name,
    columnType: i === 0 ? "DIMENSION" : "METRIC",
    dataType: i === 0 ? "FLOAT" : "INTEGER",
  }),
);

describe("retentionQuery", () => {
  it.each([
    ["all", "video==v1"],
    ["subscribed", "video==v1;subscribedStatus==SUBSCRIBED"],
    ["unsubscribed", "video==v1;subscribedStatus==UNSUBSCRIBED"],
    ["organic", "video==v1;audienceType==ORGANIC"],
  ] as const)("filters %s as %s", (audience, filters) => {
    expect(retentionQuery({ ...request, audience })).toEqual({
      startDate: "2022-05-08",
      endDate: "2026-10-03",
      dimensions: "elapsedVideoTimeRatio",
      metrics: "audienceWatchRatio,relativeRetentionPerformance,totalSegmentImpressions",
      filters,
    });
  });

  it("asks for segment counts in a separate query", () => {
    expect(retentionQuery({ ...request, audience: "all" }, SEGMENT_METRICS).metrics).toBe(
      "startedWatching,stoppedWatching",
    );
  });
});

describe("parseRetentionPoints", () => {
  it("reads a recorded curve: 100 points in bin order", () => {
    const points = parseRetentionPoints(fixture("reports.query.retention.all.json"));
    expect(points).toHaveLength(100);
    expect(points.map((point) => point.bin)).toEqual(Array.from({ length: 100 }, (_, i) => i + 1));
    expect(points[0]).toEqual({
      bin: 1,
      elapsedRatio: 0.01,
      audienceWatchRatio: 0.9838,
      relativeRetention: 0.3233,
      totalSegmentImpressions: 304,
    });
    expect(points[99]?.elapsedRatio).toBe(1);
  });

  it("returns no points for an empty report (too few views)", () => {
    expect(parseRetentionPoints(fixture("reports.query.retention-segments.json"))).toEqual([]);
  });

  it("rejects a bin twice or an elapsed ratio outside 0.01..1", () => {
    const headers = [
      { name: "elapsedVideoTimeRatio", columnType: "DIMENSION", dataType: "FLOAT" },
      { name: "audienceWatchRatio", columnType: "METRIC", dataType: "FLOAT" },
    ];
    expect(() =>
      parseRetentionPoints({
        columnHeaders: headers,
        rows: [
          [0.5, 0.4],
          [0.5, 0.3],
        ],
      }),
    ).toThrow(/bin 50 twice/);
    expect(() => parseRetentionPoints({ columnHeaders: headers, rows: [[0, 1]] })).toThrow(
      RangeError,
    );
    expect(() => parseRetentionPoints({ columnHeaders: headers, rows: [[1.2, 0.1]] })).toThrow(
      RangeError,
    );
  });
});

describe("parseSegmentCounts", () => {
  it("keys counts by bin", () => {
    const counts = parseSegmentCounts({
      columnHeaders: segmentHeaders,
      rows: [
        [0.01, 40, 12],
        [0.02, 1, 9],
      ],
    });
    expect(counts.get(1)).toEqual({ startedWatching: 40, stoppedWatching: 12 });
    expect(counts.get(2)).toEqual({ startedWatching: 1, stoppedWatching: 9 });
  });
});

describe("curveRows", () => {
  const points = parseRetentionPoints(fixture("reports.query.retention.all.json"));

  it("turns a complete curve into 100 rows with s_mono and hazard", () => {
    const { curve, coverage } = curveRows(context, points, { status: "empty" });
    expect(curve).toHaveLength(100);
    expect(curve[0]).toEqual({
      channel_id: CHANNEL,
      video_id: "fixtureVid4",
      audience: "all",
      bin: 1,
      elapsed_ratio: 0.01,
      audience_watch_ratio: 0.9838,
      relative_retention: 0.3233,
      started_watching: null,
      stopped_watching: null,
      total_segment_impressions: 304,
      s_mono: 0.9838,
      hazard: expect.closeTo(1 - 0.9838, 12),
      as_of: "2026-10-03",
    });
    for (const [i, row] of curve.entries()) {
      if (i > 0) expect(row.s_mono).toBeLessThanOrEqual(curve[i - 1]?.s_mono as number);
      expect(row.hazard).toBeGreaterThanOrEqual(0);
    }
    expect(coverage).toMatchObject({
      status: "complete",
      points: 100,
      rewatch_bumps: 3,
      details: { segment_counts: "empty" },
    });
    expect(coverage.rewatch_mass).toBeGreaterThan(0);
  });

  it("caps a looping Short at survival 1", () => {
    const short = parseRetentionPoints(fixture("reports.query.retention.short.json"));
    const { curve } = curveRows(context, short, { status: "empty" });
    expect(curve[0]).toMatchObject({ audience_watch_ratio: 1.45, s_mono: 1, hazard: 0 });
    expect(curve.every((row) => row.s_mono <= 1)).toBe(true);
  });

  it("stores segment counts when YouTube returns them", () => {
    const counts = new Map([[1, { startedWatching: 40, stoppedWatching: 12 }]]);
    const { curve, coverage } = curveRows(context, points, { status: "available", counts });
    expect(curve[0]).toMatchObject({ started_watching: 40, stopped_watching: 12 });
    expect(curve[1]).toMatchObject({ started_watching: null, stopped_watching: null });
    expect(coverage.details).toEqual({ segment_counts: "available" });
  });

  it("records why segment counts are missing", () => {
    const { coverage } = curveRows(context, points, {
      status: "error",
      message: "An internal error has occurred.",
    });
    expect(coverage.details).toEqual({
      segment_counts: "error",
      segment_error: "An internal error has occurred.",
    });
  });

  it("stores a partial curve as it arrived, never filled in", () => {
    const partial: RetentionPoint[] = points.filter((point) => point.bin % 2 === 1);
    const { curve, coverage } = curveRows(context, partial, { status: "empty" });
    expect(curve.map((row) => row.bin)).toEqual(partial.map((point) => point.bin));
    expect(coverage).toMatchObject({ status: "partial", points: 50 });
  });

  it("writes only a coverage row when there is no curve", () => {
    const { curve, coverage } = curveRows(context, [], { status: "empty" });
    expect(curve).toEqual([]);
    expect(coverage).toMatchObject({
      status: "insufficient_data",
      points: 0,
      rewatch_bumps: null,
      rewatch_mass: null,
    });
  });
});

describe("skippedCoverageRow", () => {
  it("records an audience that was not requested, with the reason", () => {
    expect(
      skippedCoverageRow({ ...context, audience: "organic" }, "ad views 0.0% of views (≤ 2%)"),
    ).toEqual({
      channel_id: CHANNEL,
      video_id: "fixtureVid4",
      audience: "organic",
      status: "skipped",
      points: 0,
      rewatch_bumps: null,
      rewatch_mass: null,
      as_of: "2026-10-03",
      details: { reason: "ad views 0.0% of views (≤ 2%)" },
    });
  });
});
