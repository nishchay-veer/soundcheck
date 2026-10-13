import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { exclusionReason, type EligibilityInput } from "./eligibility";

const NOW = new Date("2026-10-06T12:00:00Z");
const rules = { now: NOW, minViews: 500 };
const eligible: EligibilityInput = {
  contentType: "VIDEO_ON_DEMAND",
  durationS: 600,
  publishedAt: "2026-09-01T12:00:00Z",
  viewCount: 5_000,
};
const reason = (change: Partial<EligibilityInput>) =>
  exclusionReason({ ...eligible, ...change }, rules);

describe("exclusionReason", () => {
  it("accepts a settled video on demand or live stream with enough views", () => {
    expect(reason({})).toBeNull();
    expect(reason({ contentType: "LIVE_STREAM", durationS: 7_200 })).toBeNull();
  });

  it("leaves out Shorts of any length", () => {
    expect(reason({ contentType: "SHORTS", durationS: 75 })).toBe("unsupported_content_type");
    expect(reason({ contentType: "SHORTS", durationS: 31 })).toBe("unsupported_content_type");
  });

  it.each([
    [{ durationS: 60 }, null],
    [{ durationS: 59 }, "too_short"],
    [{ durationS: 10_800 }, null],
    [{ durationS: 10_801 }, "too_long"],
    [{ publishedAt: "2026-09-29T12:00:00Z" }, null],
    [{ publishedAt: "2026-09-29T12:00:00.001Z" }, "too_recent"],
    [{ viewCount: 500 }, null],
    [{ viewCount: 499 }, "too_few_views"],
    [{ contentType: "SHORTS" }, "unsupported_content_type"],
    [{ contentType: "LIVE_STREAM" }, null],
    [{ contentType: "STORY" }, "unsupported_content_type"],
    [{ contentType: "UNSPECIFIED" }, "unsupported_content_type"],
    [{ contentType: null }, "content_type_unknown"],
  ] as const)("%j gives %s", (change, expected) => {
    expect(reason(change)).toBe(expected);
  });

  it("reports the most informative reason when several apply", () => {
    // New videos have no Analytics data yet.
    expect(reason({ publishedAt: "2026-10-05T12:00:00Z", contentType: null })).toBe("too_recent");
    expect(reason({ contentType: "STORY", durationS: 15 })).toBe("unsupported_content_type");
    // Unknown content type is the last resort: another failed rule explains more.
    expect(reason({ contentType: null, viewCount: 3 })).toBe("too_few_views");
    expect(reason({ contentType: null, durationS: 30 })).toBe("too_short");
  });

  it("is eligible exactly when every rule passes", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("VIDEO_ON_DEMAND", "SHORTS", "LIVE_STREAM", "STORY", "UNSPECIFIED", null),
        fc.integer({ min: 0, max: 20_000 }),
        fc.integer({ min: 0, max: 60 }),
        fc.integer({ min: 0, max: 2_000 }),
        (contentType, durationS, ageDays, viewCount) => {
          const publishedAt = new Date(NOW.getTime() - ageDays * 86_400_000).toISOString();
          const passes =
            contentType !== null &&
            ["VIDEO_ON_DEMAND", "LIVE_STREAM"].includes(contentType) &&
            durationS >= 60 &&
            durationS <= 10_800 &&
            ageDays >= 7 &&
            viewCount >= 500;
          const result = exclusionReason({ contentType, durationS, publishedAt, viewCount }, rules);
          expect(result === null).toBe(passes);
        },
      ),
    );
  });
});
