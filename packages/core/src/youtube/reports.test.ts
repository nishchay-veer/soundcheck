import { readFileSync } from "node:fs";
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  contentTypeQuery,
  daysInRange,
  normalizeContentType,
  parseContentTypes,
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
