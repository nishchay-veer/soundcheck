import { NEWEST_VIDEOS, type VideoRow } from "@soundcheck/core/schemas";
import type { FakeBigQuery } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { capVideos } from "./cap";
import { CHANNEL, ingestTestbed, quiet, resetTestbed } from "./testbed";

const video = (
  id: string,
  day: string,
  {
    eligible = true,
    reason = null,
  }: { eligible?: boolean; reason?: VideoRow["exclusion_reason"] } = {},
): VideoRow => ({
  channel_id: CHANNEL,
  video_id: id,
  title: id,
  description: null,
  published_at: `${day}T12:00:00.000Z`,
  duration_s: 300,
  content_type: eligible ? "VIDEO_ON_DEMAND" : "SHORTS",
  is_live: false,
  category_id: null,
  tags: [],
  thumbnail_url: null,
  default_language: null,
  eligible,
  exclusion_reason: reason,
  ingested_at: "2026-10-16T09:00:00.000Z",
});
const curve = (id: string, audience = "all", status = "complete") => ({
  channel_id: CHANNEL,
  video_id: id,
  audience,
  status,
});

describe("capVideos", () => {
  let bigquery: FakeBigQuery;

  beforeEach(async () => {
    ({ bigquery } = await ingestTestbed());
  });

  afterEach(resetTestbed);

  const state = () =>
    Object.fromEntries(
      (bigquery.tables.videos ?? []).map((row) => [
        row.video_id,
        row.exclusion_reason ?? "eligible",
      ]),
    );

  it("uses the newest 100 by default", () => {
    expect(NEWEST_VIDEOS).toBe(100);
  });

  it("keeps the newest usable videos and leaves every older eligible one out", async () => {
    bigquery.tables.videos = [
      video("new-no-curve", "2026-10-01"),
      video("newest", "2026-09-01"),
      video("second", "2026-08-01"),
      video("third", "2025-06-01"),
      video("old-no-curve", "2024-01-01"),
      video("oldest", "2016-03-01"),
      video("short", "2026-09-15", { eligible: false, reason: "unsupported_content_type" }),
    ];
    bigquery.tables.retention_coverage = [
      curve("newest"),
      curve("second", "subscribed"),
      curve("third"),
      curve("oldest"),
      // Only the organic curve, which no model trains on: not usable.
      curve("old-no-curve", "organic"),
      curve("new-no-curve", "all", "partial"),
    ];
    expect(await capVideos({ channelId: CHANNEL, newest: 2, log: quiet })).toEqual({
      kept: 2,
      excluded: 3,
    });
    expect(state()).toEqual({
      // Newer than the last kept video: still eligible, though it has no curve yet.
      "new-no-curve": "eligible",
      newest: "eligible",
      second: "eligible",
      third: "beyond_newest",
      "old-no-curve": "beyond_newest",
      oldest: "beyond_newest",
      short: "unsupported_content_type",
    });
  });

  it("cuts a tie on publish time by ID, the same way every time", async () => {
    bigquery.tables.videos = [
      video("b", "2026-09-01"),
      video("a", "2026-09-01"),
      video("c", "2026-08-01"),
    ];
    bigquery.tables.retention_coverage = [curve("a"), curve("b"), curve("c")];
    await capVideos({ channelId: CHANNEL, newest: 1, log: quiet });
    expect(state()).toEqual({ a: "eligible", b: "beyond_newest", c: "beyond_newest" });
  });

  it("writes nothing for a channel with no more than the newest videos", async () => {
    const rows = [video("one", "2026-09-01"), video("two", "2016-01-01")];
    bigquery.tables.videos = rows;
    bigquery.tables.retention_coverage = [curve("one"), curve("two")];
    expect(await capVideos({ channelId: CHANNEL, newest: 2, log: quiet })).toEqual({
      kept: 2,
      excluded: 0,
    });
    expect(bigquery.tables.videos).toBe(rows);
  });
});
