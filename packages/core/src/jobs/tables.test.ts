import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { resetClients, setClientOverride } from "../gcp";
import { readChannelRows } from "./tables";

const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OTHER = "UCzYxWvUtSrQpOnMlKjIhGfE";

describe("readChannelRows", () => {
  let bigquery: FakeBigQuery;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    bigquery = new FakeBigQuery({
      video_stats: [
        { channel_id: MINE, video_id: "a", subscribed_status: "SUBSCRIBED", views: 10 },
        { channel_id: OTHER, video_id: "b", subscribed_status: "SUBSCRIBED", views: 99 },
      ],
    });
    setClientOverride("bigquery", bigquery.asBigQuery());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns the named columns of this channel's rows", async () => {
    expect(await readChannelRows("video_stats", ["video_id", "views"], MINE)).toEqual([
      { video_id: "a", views: 10 },
    ]);
    expect(bigquery.queries[0]).toMatchObject({
      query:
        "SELECT video_id, views FROM `soundcheck-test.soundcheck.video_stats` WHERE channel_id = @channelId",
      params: { channelId: MINE },
    });
  });

  it.each([
    ["table", "video_stats; DROP TABLE x", ["views"]],
    ["column", "video_stats", ["views, (SELECT 1)"]],
    ["empty column list", "video_stats", []],
  ])("rejects an invalid %s before querying", async (_, table, columns) => {
    await expect(readChannelRows(table, columns, MINE)).rejects.toThrow(RangeError);
    expect(bigquery.queries).toEqual([]);
  });
});
