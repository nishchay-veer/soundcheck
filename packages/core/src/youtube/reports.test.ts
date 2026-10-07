import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  contentTypeQuery,
  daysInRange,
  normalizeContentType,
  deviceBucket,
  deviceQuery,
  parseContentTypes,
  parseDeviceMix,
  parseStats,
  parseTrafficMix,
  statsQuery,
  trafficBatchSize,
  trafficBucket,
  trafficQuery,
  videoBatches,
} from "./reports";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../../tests/fixtures/youtube/${name}`, import.meta.url), "utf8"),
  );

const video = (id: string, publishedAt: string) => ({ id, publishedAt });

describe("daysInRange", () => {
  it("counts both ends", () => {
    expect(daysInRange("2026-10-03", "2026-10-03")).toBe(1);
    expect(daysInRange("2026-09-01", "2026-10-03")).toBe(33);
    expect(daysInRange("2024-01-01", "2024-12-31")).toBe(366);
  });
});

describe("videoBatches", () => {
  it("batches oldest first, each starting at its oldest video's Pacific date", () => {
    const batches = videoBatches(
      [
        video("c", "2026-09-20T12:00:00Z"),
        // 05:00 UTC on Sep 2 is still Sep 1 in California.
        video("a", "2026-09-02T05:00:00Z"),
        video("b", "2026-09-10T12:00:00Z"),
      ],
      "2026-10-03",
      () => 2,
    );
    expect(batches).toEqual([
      { videoIds: ["a", "b"], startDate: "2026-09-01", endDate: "2026-10-03" },
      { videoIds: ["c"], startDate: "2026-09-20", endDate: "2026-10-03" },
    ]);
  });

  it("leaves out videos published after the end date", () => {
    const batches = videoBatches(
      [video("old", "2026-09-01T12:00:00Z"), video("new", "2026-10-05T12:00:00Z")],
      "2026-10-03",
    );
    expect(batches.flatMap((batch) => batch.videoIds)).toEqual(["old"]);
    expect(videoBatches([video("new", "2026-10-05T12:00:00Z")], "2026-10-03")).toEqual([]);
  });

  it("sizes each batch from the days its range covers", () => {
    const sizes: number[] = [];
    videoBatches(
      [video("a", "2026-01-01T12:00:00Z"), video("b", "2026-09-01T12:00:00Z")],
      "2026-10-03",
      (days) => {
        sizes.push(days);
        return 1;
      },
    );
    expect(sizes).toEqual([276, 33]);
  });

  it("covers every publishable video exactly once and respects the cap", () => {
    const dates = fc.integer({ min: Date.parse("2015-01-01"), max: Date.parse("2026-10-10") });
    fc.assert(
      fc.property(
        fc.array(dates, { maxLength: 80 }),
        fc.integer({ min: 1, max: 30 }),
        (times, cap) => {
          const videos = times.map((time, index) =>
            video(`v${index}`, new Date(time).toISOString()),
          );
          const batches = videoBatches(videos, "2026-10-03", () => cap);
          const ids = batches.flatMap((batch) => batch.videoIds);
          expect(new Set(ids).size).toBe(ids.length);
          for (const batch of batches) expect(batch.videoIds.length).toBeLessThanOrEqual(cap);
          for (const batch of batches) expect(batch.startDate <= batch.endDate).toBe(true);
        },
      ),
    );
  });
});

describe("contentTypeQuery", () => {
  it("asks for video and creatorContentType over the batch's range", () => {
    expect(
      contentTypeQuery({ videoIds: ["a", "b"], startDate: "2022-05-08", endDate: "2026-10-03" }),
    ).toEqual({
      startDate: "2022-05-08",
      endDate: "2026-10-03",
      dimensions: "video,creatorContentType",
      metrics: "views",
      filters: "video==a,b",
    });
  });
});

describe("normalizeContentType", () => {
  it.each([
    ["videoOnDemand", "VIDEO_ON_DEMAND"],
    ["shorts", "SHORTS"],
    ["liveStream", "LIVE_STREAM"],
    ["story", "STORY"],
    ["VIDEO_ON_DEMAND", "VIDEO_ON_DEMAND"],
  ])("%s becomes %s", (value, expected) => {
    expect(normalizeContentType(value)).toBe(expected);
  });
});

describe("parseContentTypes", () => {
  it("reads a recorded content-type report", () => {
    expect(parseContentTypes(fixture("reports.query.content-type.json"))).toEqual(
      new Map([
        ["fixtureVid3", "VIDEO_ON_DEMAND"],
        ["fixtureVid4", "VIDEO_ON_DEMAND"],
        ["fixtureVid1", "VIDEO_ON_DEMAND"],
        ["fixtureVid2", "SHORTS"],
      ]),
    );
  });

  it("keeps the type with the most views when a video has several", () => {
    const body = {
      columnHeaders: [
        { name: "video", columnType: "DIMENSION", dataType: "STRING" },
        { name: "creatorContentType", columnType: "DIMENSION", dataType: "STRING" },
        { name: "views", columnType: "METRIC", dataType: "INTEGER" },
      ],
      rows: [
        ["v", "liveStream", 40],
        ["v", "videoOnDemand", 900],
      ],
    };
    expect(parseContentTypes(body).get("v")).toBe("VIDEO_ON_DEMAND");
  });

  it("is empty when no video has data", () => {
    expect(
      parseContentTypes({
        columnHeaders: [{ name: "video", columnType: "DIMENSION", dataType: "STRING" }],
      }).size,
    ).toBe(0);
  });
});

describe("statsQuery", () => {
  it("asks for lifetime totals per video and subscribed status", () => {
    expect(
      statsQuery({ videoIds: ["a", "b"], startDate: "2022-05-08", endDate: "2026-10-03" }),
    ).toEqual({
      startDate: "2022-05-08",
      endDate: "2026-10-03",
      dimensions: "video,subscribedStatus",
      metrics:
        "views,engagedViews,estimatedMinutesWatched,averageViewDuration,averageViewPercentage",
      filters: "video==a,b",
    });
  });
});

describe("parseStats", () => {
  const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
  const context = (videoIds: string[]) => ({ channelId: CHANNEL, asOf: "2026-10-03", videoIds });
  const headers = [
    "video",
    "subscribedStatus",
    "views",
    "engagedViews",
    "estimatedMinutesWatched",
    "averageViewDuration",
    "averageViewPercentage",
  ].map((name, index) => ({
    name,
    columnType: index < 2 ? "DIMENSION" : "METRIC",
    dataType: index < 2 ? "STRING" : "INTEGER",
  }));

  it("reads a recorded stats report: one row per video and status", () => {
    const rows = parseStats(
      fixture("reports.query.stats.json"),
      context(["fixtureVid1", "fixtureVid2", "fixtureVid3", "fixtureVid4"]),
    );
    expect(rows).toHaveLength(8);
    expect(rows.slice(0, 2)).toEqual([
      {
        channel_id: CHANNEL,
        video_id: "fixtureVid1",
        subscribed_status: "SUBSCRIBED",
        views: 42,
        engaged_views: 42,
        estimated_minutes_watched: 42,
        average_view_duration_s: 60,
        average_view_percentage: 68.28,
        as_of: "2026-10-03",
      },
      {
        channel_id: CHANNEL,
        video_id: "fixtureVid1",
        subscribed_status: "UNSUBSCRIBED",
        views: 300,
        engaged_views: 299,
        estimated_minutes_watched: 299,
        average_view_duration_s: 60,
        average_view_percentage: 68.37,
        as_of: "2026-10-03",
      },
    ]);
    // A looping Short is watched past 100%.
    expect(rows.find((row) => row.video_id === "fixtureVid2")?.average_view_percentage).toBe(
      113.86,
    );
  });

  it("fills slices Analytics leaves out with zero views and no averages", () => {
    const body = { columnHeaders: headers, rows: [["a", "UNSUBSCRIBED", 12, 12, 3, 15, 40.5]] };
    const rows = parseStats(body, context(["a", "quiet"]));
    expect(rows.map((row) => [row.video_id, row.subscribed_status, row.views])).toEqual([
      ["a", "SUBSCRIBED", 0],
      ["a", "UNSUBSCRIBED", 12],
      ["quiet", "SUBSCRIBED", 0],
      ["quiet", "UNSUBSCRIBED", 0],
    ]);
    expect(rows[0]).toMatchObject({
      engaged_views: 0,
      estimated_minutes_watched: 0,
      average_view_duration_s: null,
      average_view_percentage: null,
    });
    expect(parseStats({ columnHeaders: headers }, context(["quiet"]))).toHaveLength(2);
  });

  it("drops averages for a slice reported with zero views", () => {
    const body = { columnHeaders: headers, rows: [["a", "SUBSCRIBED", 0, 0, 0, 0, 0]] };
    expect(parseStats(body, context(["a"]))[0]).toMatchObject({
      views: 0,
      average_view_duration_s: null,
      average_view_percentage: null,
    });
  });

  it("rejects rows for videos it did not ask about, or a slice twice", () => {
    const row = ["a", "SUBSCRIBED", 1, 1, 1, 1, 1];
    expect(() => parseStats({ columnHeaders: headers, rows: [row] }, context(["b"]))).toThrow(
      /unrequested video a/,
    );
    expect(() => parseStats({ columnHeaders: headers, rows: [row, row] }, context(["a"]))).toThrow(
      /2 rows for a SUBSCRIBED/,
    );
    expect(() =>
      parseStats(
        { columnHeaders: headers, rows: [["a", "MEMBERS", 1, 1, 1, 1, 1]] },
        context(["a"]),
      ),
    ).toThrow();
  });
});

describe("trafficBatchSize", () => {
  it.each([
    [1, 25],
    [2_000, 25],
    [2_001, 24],
    [1_609, 25],
    [10_000, 5],
    [50_000, 1],
    [90_000, 1],
  ])("%i days allows %i videos", (days, size) => {
    expect(trafficBatchSize(days)).toBe(size);
  });

  it("keeps videos × days within 50,000 whenever a batch has more than one video", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 100_000 }), (days) => {
        const size = trafficBatchSize(days);
        if (size > 1) expect(size * days).toBeLessThanOrEqual(50_000);
      }),
    );
  });
});

describe("buckets", () => {
  it.each([
    ["YT_SEARCH", "search"],
    ["RELATED_VIDEO", "suggested"],
    ["END_SCREEN", "suggested"],
    ["SUBSCRIBER", "browse"],
    ["NOTIFICATION", "browse"],
    ["YT_CHANNEL", "browse"],
    ["PLAYLIST", "browse"],
    ["EXT_URL", "external"],
    ["NO_LINK_EMBEDDED", "external"],
    ["NO_LINK_OTHER", "external"],
    ["SHORTS", "other"],
    ["HASHTAGS", "other"],
    ["ADVERTISING", "other"],
    ["YT_OTHER_PAGE", "other"],
    ["SOMETHING_NEW", "other"],
  ])("traffic %s is %s", (rawType, bucket) => {
    expect(trafficBucket(rawType)).toBe(bucket);
  });

  it.each([
    ["MOBILE", "mobile"],
    ["TABLET", "mobile"],
    ["TV", "tv"],
    ["GAME_CONSOLE", "tv"],
    ["DESKTOP", "desktop"],
    ["AUTOMOTIVE", "other"],
    ["WEARABLE", "other"],
    ["UNKNOWN_PLATFORM", "other"],
  ])("device %s is %s", (rawType, bucket) => {
    expect(deviceBucket(rawType)).toBe(bucket);
  });
});

describe("mix queries", () => {
  const batch = { videoIds: ["a", "b"], startDate: "2022-05-08", endDate: "2026-10-03" };

  it("splits traffic sources and devices by video and subscribed status", () => {
    expect(trafficQuery(batch)).toEqual({
      startDate: "2022-05-08",
      endDate: "2026-10-03",
      dimensions: "video,insightTrafficSourceType,subscribedStatus",
      metrics: "views,engagedViews,estimatedMinutesWatched",
      filters: "video==a,b",
    });
    expect(deviceQuery(batch).dimensions).toBe("video,deviceType,subscribedStatus");
  });
});

describe("mix parsers", () => {
  const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
  const ALL = ["fixtureVid1", "fixtureVid2", "fixtureVid3", "fixtureVid4"];
  const context = (videoIds: readonly string[] = ALL) => ({
    channelId: CHANNEL,
    asOf: "2026-10-03",
    videoIds,
  });

  /** Sum of shares per video and subscribed status. */
  const shareSums = (
    rows: Array<{ video_id: string; subscribed_status: string; share: number }>,
  ) => {
    const sums = new Map<string, number>();
    for (const row of rows) {
      const key = `${row.video_id} ${row.subscribed_status}`;
      sums.set(key, (sums.get(key) ?? 0) + row.share);
    }
    return sums;
  };

  it("reads a recorded traffic report: shares of each slice sum to 1", () => {
    const rows = parseTrafficMix(fixture("reports.query.traffic.json"), context());
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.views > 0 && row.channel_id === CHANNEL)).toBe(true);
    const sums = shareSums(rows);
    expect(sums.size).toBe(8);
    for (const sum of sums.values()) expect(sum).toBeCloseTo(1, 9);
    expect(rows.find((row) => row.raw_type === "SHORTS")?.bucket).toBe("other");
    expect(rows.find((row) => row.raw_type === "YT_SEARCH")?.bucket).toBe("search");
  });

  it("reads a recorded device report: shares of each slice sum to 1", () => {
    const rows = parseDeviceMix(fixture("reports.query.device.json"), context());
    const sums = shareSums(rows);
    expect(sums.size).toBe(8);
    for (const sum of sums.values()) expect(sum).toBeCloseTo(1, 9);
    expect(new Set(rows.map((row) => row.bucket))).toEqual(new Set(["mobile", "tv", "desktop"]));
  });

  const headers = ["video", "deviceType", "subscribedStatus", "views", "engagedViews"].map(
    (name, index) => ({
      name,
      columnType: index < 3 ? "DIMENSION" : "METRIC",
      dataType: index < 3 ? "STRING" : "INTEGER",
    }),
  );

  it("computes each share from its own video and subscribed status", () => {
    const body = {
      columnHeaders: headers,
      rows: [
        ["a", "MOBILE", "SUBSCRIBED", 30, 30],
        ["a", "TV", "SUBSCRIBED", 10, 9],
        ["a", "MOBILE", "UNSUBSCRIBED", 5, 5],
        ["a", "DESKTOP", "UNSUBSCRIBED", 0, 0],
      ],
    };
    expect(
      parseDeviceMix(body, context(["a"])).map((row) => [
        row.subscribed_status,
        row.raw_type,
        row.bucket,
        row.share,
        row.engaged_views,
      ]),
    ).toEqual([
      ["SUBSCRIBED", "MOBILE", "mobile", 0.75, 30],
      ["SUBSCRIBED", "TV", "tv", 0.25, 9],
      ["UNSUBSCRIBED", "MOBILE", "mobile", 1, 5],
    ]);
  });

  it("writes no rows for a slice without views", () => {
    const body = { columnHeaders: headers, rows: [["a", "MOBILE", "SUBSCRIBED", 0, 0]] };
    expect(parseDeviceMix(body, context(["a"]))).toEqual([]);
    expect(parseDeviceMix({ columnHeaders: headers }, context(["a"]))).toEqual([]);
  });

  it("rejects a raw type reported twice for one slice, or an unrequested video", () => {
    const row = ["a", "MOBILE", "SUBSCRIBED", 3, 3];
    expect(() =>
      parseDeviceMix({ columnHeaders: headers, rows: [row, row] }, context(["a"])),
    ).toThrow(/MOBILE twice for a SUBSCRIBED/);
    expect(() => parseDeviceMix({ columnHeaders: headers, rows: [row] }, context(["b"]))).toThrow(
      /unrequested video a/,
    );
  });

  it("always gives shares summing to 1 per slice that has views", () => {
    const deviceRow = fc.tuple(
      fc.constantFrom("v1", "v2"),
      fc.constantFrom("MOBILE", "TV", "DESKTOP", "TABLET", "WEARABLE"),
      fc.constantFrom("SUBSCRIBED", "UNSUBSCRIBED"),
      fc.nat({ max: 1_000_000 }),
    );
    fc.assert(
      fc.property(
        fc.uniqueArray(deviceRow, {
          selector: ([video, type, status]) => `${video}${type}${status}`,
        }),
        (rows) => {
          const body = {
            columnHeaders: headers,
            rows: rows.map(([video, type, status, views]) => [video, type, status, views, views]),
          };
          const parsed = parseDeviceMix(body, context(["v1", "v2"]));
          for (const sum of shareSums(parsed).values())
            expect(Math.abs(sum - 1)).toBeLessThan(0.01);
          const withViews = new Set(
            rows
              .filter(([, , , views]) => views > 0)
              .map(([video, , status]) => `${video} ${status}`),
          );
          expect(new Set(shareSums(parsed).keys())).toEqual(withViews);
        },
      ),
    );
  });
});
