import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays, analyticsEndDate, pacificDate, reportRows } from "./analytics";

const headers = [
  { name: "video", columnType: "DIMENSION", dataType: "STRING" },
  { name: "subscribedStatus", columnType: "DIMENSION", dataType: "STRING" },
  { name: "views", columnType: "METRIC", dataType: "INTEGER" },
  { name: "averageViewDuration", columnType: "METRIC", dataType: "FLOAT" },
];

describe("reportRows", () => {
  it("keys each row by its column names", () => {
    const body = {
      kind: "youtubeAnalytics#resultTable",
      columnHeaders: headers,
      rows: [
        ["fixtureVid1", "SUBSCRIBED", 120, 95.5],
        ["fixtureVid1", "UNSUBSCRIBED", 880, 61.2],
      ],
    };
    expect(reportRows(body)).toEqual([
      {
        video: "fixtureVid1",
        subscribedStatus: "SUBSCRIBED",
        views: 120,
        averageViewDuration: 95.5,
      },
      {
        video: "fixtureVid1",
        subscribedStatus: "UNSUBSCRIBED",
        views: 880,
        averageViewDuration: 61.2,
      },
    ]);
  });

  it("treats a response without rows as no data", () => {
    expect(reportRows({ kind: "youtubeAnalytics#resultTable", columnHeaders: headers })).toEqual(
      [],
    );
    expect(reportRows({ columnHeaders: headers, rows: null })).toEqual([]);
  });

  it("rejects a row that does not match the headers", () => {
    expect(() => reportRows({ columnHeaders: headers, rows: [["fixtureVid1", 3]] })).toThrow(
      /2 values for 4 columns/,
    );
  });

  it("rejects a body that is not a result table", () => {
    expect(() => reportRows({ error: { code: 400 } })).toThrow();
  });
});

describe("pacificDate", () => {
  it.each([
    // PDT is UTC-7: early UTC morning is still the previous day in California.
    ["2026-10-06T06:59:59Z", "2026-10-05"],
    ["2026-10-06T07:00:00Z", "2026-10-06"],
    // PST is UTC-8.
    ["2026-01-01T07:59:59Z", "2025-12-31"],
    ["2026-01-01T08:00:00Z", "2026-01-01"],
  ])("%s is %s in Pacific time", (instant, expected) => {
    expect(pacificDate(new Date(instant))).toBe(expected);
  });
});

describe("addDays", () => {
  it("crosses month, year and leap-day boundaries", () => {
    expect(addDays("2026-10-01", -3)).toBe("2026-09-28");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
  });

  it("round-trips any whole number of days", () => {
    fc.assert(
      fc.property(fc.integer({ min: -20_000, max: 20_000 }), (days) => {
        expect(addDays(addDays("2026-10-06", days), -days)).toBe("2026-10-06");
      }),
    );
  });

  it("rejects a malformed date", () => {
    expect(() => addDays("10/06/2026", 1)).toThrow(RangeError);
  });
});

describe("analyticsEndDate", () => {
  it("ends three days before today in Pacific time", () => {
    expect(analyticsEndDate(new Date("2026-10-06T18:00:00Z"))).toBe("2026-10-03");
    expect(analyticsEndDate(new Date("2026-10-06T03:00:00Z"))).toBe("2026-10-02");
  });
});
