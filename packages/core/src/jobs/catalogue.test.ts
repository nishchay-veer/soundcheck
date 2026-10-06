import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { resetClients, setClientOverride } from "../gcp";
import { eligibleVideos } from "./catalogue";

const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OTHER = "UCzYxWvUtSrQpOnMlKjIhGfE";

describe("eligibleVideos", () => {
  let bigquery: FakeBigQuery;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    bigquery = new FakeBigQuery({
      videos: [
        { channel_id: MINE, video_id: "new", published_at: "2026-09-01T10:00:00Z", eligible: true },
        {
          channel_id: MINE,
          video_id: "short",
          published_at: "2025-01-01T10:00:00Z",
          eligible: false,
        },
        // BigQuery returns TIMESTAMP columns as objects.
        {
          channel_id: MINE,
          video_id: "old",
          published_at: { value: "2022-05-08T16:00:26.000Z" },
          eligible: true,
        },
        {
          channel_id: OTHER,
          video_id: "theirs",
          published_at: "2024-01-01T10:00:00Z",
          eligible: true,
        },
      ],
    });
    setClientOverride("bigquery", bigquery.asBigQuery());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns this channel's eligible videos, oldest first", async () => {
    expect(await eligibleVideos(MINE)).toEqual([
      { id: "old", publishedAt: "2022-05-08T16:00:26.000Z" },
      { id: "new", publishedAt: "2026-09-01T10:00:00Z" },
    ]);
    expect(bigquery.queries[0]).toMatchObject({ params: { channelId: MINE }, location: "US" });
  });

  it("rejects a malformed channel ID before querying", async () => {
    await expect(eligibleVideos("UC1")).rejects.toThrow();
    expect(bigquery.queries).toEqual([]);
  });
});
