import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeFirestore } from "../fake-firestore";
import { resetClients, setClientOverride } from "../gcp";
import { isStepDone, markStepDone, readStepMarker } from "./steps";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const KEY = { asOf: "2026-10-03", version: "ingest-v1" };

describe("step markers", () => {
  let db: FakeFirestore;

  beforeEach(() => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
  });

  afterEach(() => {
    vi.useRealTimers();
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("records a finished step under the channel", async () => {
    await markStepDone(CHANNEL, "ingest-stats", { ...KEY, rows: { video_stats: 4 } });
    expect(db.docs.get(`channels/${CHANNEL}/steps/ingest-stats`)).toEqual({
      ...KEY,
      rows: { video_stats: 4 },
      finishedAt: new Date("2026-10-06T12:00:00Z"),
    });
  });

  it("is done only for the same data date and version", async () => {
    expect(await isStepDone(CHANNEL, "ingest-stats", KEY)).toBe(false);
    await markStepDone(CHANNEL, "ingest-stats", { ...KEY, rows: {} });
    expect(await isStepDone(CHANNEL, "ingest-stats", KEY)).toBe(true);
    expect(await isStepDone(CHANNEL, "ingest-stats", { ...KEY, asOf: "2026-10-04" })).toBe(false);
    expect(await isStepDone(CHANNEL, "ingest-stats", { ...KEY, version: "ingest-v2" })).toBe(false);
    expect(await isStepDone(CHANNEL, "ingest-mix", KEY)).toBe(false);
  });

  it("reads the last finished run, or null", async () => {
    expect(await readStepMarker(CHANNEL, "ingest-stats")).toBeNull();
    await markStepDone(CHANNEL, "ingest-stats", { ...KEY, rows: { video_stats: 2 } });
    expect(await readStepMarker(CHANNEL, "ingest-stats")).toMatchObject({
      ...KEY,
      rows: { video_stats: 2 },
    });
  });

  it("treats a malformed marker as not done", async () => {
    await db.collection(`channels/${CHANNEL}/steps`).doc("ingest-stats").set({ asOf: "yesterday" });
    expect(await isStepDone(CHANNEL, "ingest-stats", KEY)).toBe(false);
  });

  it.each(["../users", "a/b", ""])("rejects the step name %j", async (step) => {
    await expect(isStepDone(CHANNEL, step, KEY)).rejects.toThrow(RangeError);
  });
});
