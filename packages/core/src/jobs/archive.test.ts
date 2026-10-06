import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { archiveRaw, rawObjectName } from "./archive";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const FETCHED = new Date("2026-10-06T23:30:00Z");

describe("rawObjectName", () => {
  it("is {channel}/{source}/{key}/{yyyymmdd}.json, dated in UTC", () => {
    expect(
      rawObjectName({
        channelId: CHANNEL,
        source: "analytics-stats",
        key: "batch-001",
        fetchedAt: FETCHED,
      }),
    ).toBe(`${CHANNEL}/analytics-stats/batch-001/20261006.json`);
  });

  it.each(["", ".", "..", "a/b", "../escape", "has space"])("rejects the segment %j", (segment) => {
    expect(() => rawObjectName({ channelId: CHANNEL, source: segment, key: "k" })).toThrow();
    expect(() => rawObjectName({ channelId: CHANNEL, source: "s", key: segment })).toThrow();
  });

  it("rejects a malformed channel ID", () => {
    expect(() => rawObjectName({ channelId: "../users", source: "s", key: "k" })).toThrow();
  });
});

describe("archiveRaw", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    storage = new FakeStorage();
    setClientOverride("storage", storage.asStorage());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("writes the body exactly as received, with the request as metadata", async () => {
    const body = { kind: "youtubeAnalytics#resultTable", rows: [["a", 1]] };
    const request = { metrics: "views", filters: "video==a" };
    const uri = await archiveRaw({
      channelId: CHANNEL,
      source: "analytics-stats",
      key: "batch-001",
      body,
      request,
      fetchedAt: FETCHED,
    });

    expect(uri).toBe(`gs://test-raw/${CHANNEL}/analytics-stats/batch-001/20261006.json`);
    expect(JSON.parse(storage.read(uri) ?? "")).toEqual(body);
    const options = storage.saveOptions.get(uri.slice("gs://".length));
    expect(options?.contentType).toBe("application/json");
    expect(JSON.parse(options?.metadata?.metadata?.request ?? "")).toEqual(request);
  });

  it("overwrites the same object on a same-day re-run", async () => {
    const write = (n: number) =>
      archiveRaw({ channelId: CHANNEL, source: "s", key: "k", body: { n }, fetchedAt: FETCHED });
    await write(1);
    const uri = await write(2);
    expect(storage.buckets["test-raw"]?.size).toBe(1);
    expect(JSON.parse(storage.read(uri) ?? "")).toEqual({ n: 2 });
  });
});
