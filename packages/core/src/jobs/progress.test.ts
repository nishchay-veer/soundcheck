import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { resetEnvCache } from "../env";
import { FakeDocRef, FakeFirestore } from "../fake-firestore";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { memoryLogger } from "../test-utils";
import { progressWriter } from "./progress";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const quiet = createLogger({ level: "silent" });

describe("progressWriter", () => {
  let db: FakeFirestore;
  let update: MockInstance<FakeDocRef["update"]>;

  beforeEach(async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T12:00:00Z") });
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
    await db
      .collection("channels")
      .doc(CHANNEL)
      .set({ build: { state: "running" } });
    update = vi.spyOn(FakeDocRef.prototype, "update");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const build = () => db.docs.get(`channels/${CHANNEL}`)?.build as Record<string, unknown>;

  it("writes the first update at once, next to the build state", async () => {
    const progress = progressWriter(CHANNEL, "ingest", { log: quiet });
    progress.update(1, 10);
    await progress.flush();
    expect(build()).toEqual({
      state: "running",
      progress: {
        stage: "ingest",
        done: 1,
        total: 10,
        updatedAt: new Date("2026-10-06T12:00:00Z"),
      },
    });
  });

  it("writes at most once per 5 s, ending on the latest value", async () => {
    const progress = progressWriter(CHANNEL, "ingest", { log: quiet });
    for (let done = 1; done <= 6; done += 1) {
      progress.update(done, 6);
      await vi.advanceTimersByTimeAsync(1_000);
    }
    // t=0 wrote 1/6; t=5 s wrote the latest value then, 5/6; 6/6 waits for t=10 s.
    expect(update).toHaveBeenCalledTimes(2);
    expect(build().progress).toMatchObject({ done: 5, total: 6 });
    await vi.advanceTimersByTimeAsync(4_000);
    expect(update).toHaveBeenCalledTimes(3);
    expect(build().progress).toMatchObject({ done: 6, total: 6 });
  });

  it("flush writes a pending value immediately and cancels the timer", async () => {
    const progress = progressWriter(CHANNEL, "ingest", { log: quiet });
    progress.update(1, 3);
    progress.update(3, 3);
    await progress.flush();
    expect(build().progress).toMatchObject({ done: 3, total: 3 });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it("logs a failed write instead of failing the job", async () => {
    const { lines, logger } = memoryLogger();
    update.mockRejectedValueOnce(new Error("14 UNAVAILABLE"));
    const progress = progressWriter(CHANNEL, "ingest", { log: logger });
    progress.update(1, 2);
    await expect(progress.flush()).resolves.toBeUndefined();
    expect(lines).toEqual([
      expect.objectContaining({
        severity: "WARNING",
        message: "build progress write failed",
        channel_id: CHANNEL,
      }),
    ]);
  });

  it("rejects progress past the total", () => {
    const progress = progressWriter(CHANNEL, "ingest", { log: quiet });
    expect(() => progress.update(4, 3)).toThrow(/done must not exceed total/);
  });
});
