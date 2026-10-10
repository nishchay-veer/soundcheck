import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeBigQuery } from "../fake-bigquery";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { replaceChannelRows } from "./bigquery-load";

const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OTHER = "UCzYxWvUtSrQpOnMlKjIhGfE";
const quiet = createLogger({ level: "silent" });

const stat = (channel_id: string, video_id: string, views: number) => ({
  channel_id,
  video_id,
  subscribed_status: "SUBSCRIBED",
  views,
  as_of: "2026-10-03",
});

describe("replaceChannelRows", () => {
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv("BQ_DATASET", "soundcheck");
    vi.stubEnv("BQ_LOCATION", "US");
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    storage = new FakeStorage();
    bigquery = new FakeBigQuery(
      { video_stats: [stat(MINE, "old", 1), stat(OTHER, "theirs", 2)] },
      {
        columns: { video_stats: ["channel_id", "video_id", "subscribed_status", "views", "as_of"] },
        storage,
      },
    );
    setClientOverride("bigquery", bigquery.asBigQuery());
    setClientOverride("storage", storage.asStorage());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const replace = (rows: Array<Record<string, unknown>>, runId = "run1") =>
    replaceChannelRows({ table: "video_stats", channelId: MINE, rows, runId, log: quiet });

  it("replaces this channel's rows and leaves other channels alone", async () => {
    const rows = [stat(MINE, "a", 10), stat(MINE, "b", 20)];
    await expect(replace(rows)).resolves.toBe(2);
    expect(bigquery.tables.video_stats).toEqual([stat(OTHER, "theirs", 2), ...rows]);
  });

  it("loads NDJSON from the channel's staging prefix into a staging table with the target schema", async () => {
    await replace([stat(MINE, "a", 10)]);

    const [load] = bigquery.loads;
    expect(load?.location).toBe("US");
    expect(load?.configuration.load).toEqual({
      sourceUris: [`gs://test-raw/${MINE}/staging/video_stats/run1.ndjson`],
      sourceFormat: "NEWLINE_DELIMITED_JSON",
      destinationTable: {
        projectId: "soundcheck-test",
        datasetId: "soundcheck",
        tableId: "_staging_video_stats_run1",
      },
      writeDisposition: "WRITE_EMPTY",
    });
    const staging = bigquery.created.get("_staging_video_stats_run1");
    expect(staging?.schema).toEqual({
      fields: ["channel_id", "video_id", "subscribed_status", "views", "as_of"].map((name) => ({
        name,
      })),
    });
    expect(Number(staging?.expirationTime)).toBeGreaterThan(Date.now());
  });

  it("swaps the rows in one parameterized transaction", async () => {
    await replace([stat(MINE, "a", 10)]);
    const transaction = bigquery.queries.at(-1);
    expect(transaction?.params).toEqual({ channelId: MINE });
    expect(transaction?.location).toBe("US");
    expect(transaction?.query.split("\n")).toEqual([
      "BEGIN TRANSACTION;",
      "DELETE FROM `soundcheck-test.soundcheck.video_stats` WHERE channel_id = @channelId;",
      "INSERT INTO `soundcheck-test.soundcheck.video_stats` (`channel_id`, `video_id`, `subscribed_status`, `views`, `as_of`) SELECT `channel_id`, `video_id`, `subscribed_status`, `views`, `as_of` FROM `soundcheck-test.soundcheck._staging_video_stats_run1` WHERE channel_id = @channelId;",
      "COMMIT TRANSACTION;",
    ]);
  });

  it("drops the staging table and object afterwards", async () => {
    await replace([stat(MINE, "a", 10)]);
    expect(Object.keys(bigquery.tables)).toEqual(["video_stats"]);
    expect(storage.buckets["test-raw"]?.size).toBe(0);
  });

  it("produces no duplicates when run again", async () => {
    const rows = [stat(MINE, "a", 10), stat(MINE, "b", 20)];
    await replace(rows, "run1");
    await replace(rows, "run2");
    expect(bigquery.tables.video_stats).toEqual([stat(OTHER, "theirs", 2), ...rows]);
  });

  it("only deletes when there are no new rows", async () => {
    await expect(replace([])).resolves.toBe(0);
    expect(bigquery.tables.video_stats).toEqual([stat(OTHER, "theirs", 2)]);
    expect(bigquery.loads).toEqual([]);
  });

  it("keeps the old rows and cleans up when the load fails", async () => {
    bigquery.failLoads = new Error("Error while reading data");
    await expect(replace([stat(MINE, "a", 10)])).rejects.toThrow("Error while reading data");
    expect(bigquery.tables.video_stats).toEqual([stat(MINE, "old", 1), stat(OTHER, "theirs", 2)]);
    expect(Object.keys(bigquery.tables)).toEqual(["video_stats"]);
    expect(storage.buckets["test-raw"]?.size).toBe(0);
  });

  it("keeps the old rows when the transaction fails", async () => {
    bigquery.failDeletes = new Error("Transaction is aborted due to concurrent update");
    await expect(replace([stat(MINE, "a", 10)])).rejects.toThrow("concurrent update");
    expect(bigquery.tables.video_stats).toEqual([stat(MINE, "old", 1), stat(OTHER, "theirs", 2)]);
  });

  it("can replace only some videos' rows and keep the channel's others", async () => {
    bigquery.tables.video_stats?.push(stat(MINE, "recent", 3));
    const replaced = await replaceChannelRows({
      table: "video_stats",
      channelId: MINE,
      rows: [stat(MINE, "recent", 30)],
      runId: "run2",
      videoIds: ["recent"],
      log: quiet,
    });
    expect(replaced).toBe(1);
    expect(bigquery.tables.video_stats).toEqual([
      stat(MINE, "old", 1),
      stat(OTHER, "theirs", 2),
      stat(MINE, "recent", 30),
    ]);
    const transaction = bigquery.queries.at(-1);
    expect(transaction?.query).toContain(
      "WHERE channel_id = @channelId AND video_id IN UNNEST(@videoIds);",
    );
    expect(transaction?.params).toEqual({ channelId: MINE, videoIds: ["recent"] });
  });

  it("refuses a row outside the videos replaced, and does nothing for none", async () => {
    const scoped = (rows: Array<Record<string, unknown>>, videoIds: string[]) =>
      replaceChannelRows({
        table: "video_stats",
        channelId: MINE,
        rows,
        runId: "run3",
        videoIds,
        log: quiet,
      });
    await expect(scoped([stat(MINE, "old", 5)], ["recent"])).rejects.toThrow(
      "A row for video old is outside the videos replaced",
    );
    await expect(scoped([], [])).resolves.toBe(0);
    expect(bigquery.queries).toEqual([]);
    expect(bigquery.tables.video_stats).toHaveLength(2);
  });

  it("refuses a row that belongs to another channel", async () => {
    await expect(replace([stat(MINE, "a", 1), stat(OTHER, "b", 2)])).rejects.toThrow(
      `A row for ${OTHER}`,
    );
    expect(bigquery.queries).toEqual([]);
  });

  it.each([
    ["table", { table: "video_stats`; DROP TABLE x; --" }],
    ["run ID", { runId: "run-1" }],
    ["channel ID", { channelId: "UC123" }],
  ])("rejects an invalid %s before touching BigQuery", async (_, override) => {
    await expect(
      replaceChannelRows({
        table: "video_stats",
        channelId: MINE,
        rows: [],
        runId: "run1",
        log: quiet,
        ...override,
      }),
    ).rejects.toThrow();
    expect(bigquery.queries).toEqual([]);
  });
});
