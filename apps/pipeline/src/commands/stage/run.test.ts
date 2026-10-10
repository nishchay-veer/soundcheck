import { resetEnvCache } from "@soundcheck/core";
import type { FakeBigQuery } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { STEPS, countVideos, runStage, stageTarget } from "./run";

const NOW = new Date("2026-10-10T03:00:00Z");

/** Every step a stage can call, recording its options; none touches an API. */
function fakeSteps() {
  return {
    ingestCatalogue: vi.fn(async () => []),
    ingestStats: vi.fn(async () => []),
    ingestMix: vi.fn(async () => undefined),
    ingestRetention: vi.fn(async () => undefined),
    extractBeats: vi.fn(async () => ({
      outcomes: [{ status: "extracted" }, { status: "cached" }, { status: "cached" }],
    })),
    loadBeats: vi.fn(async () => ({ videos: 3, beats: 20, runs: 3 })),
    buildFeatures: vi.fn(async () => ({ rows: 900, used: ["a", "b", "c"], written: true })),
    runBaselineLlm: vi.fn(async () => ({ outcomes: [{}, {}, {}], mode: "check", rows: 3 })),
    recordBuildCounts: vi.fn(async () => undefined),
  } as unknown as typeof STEPS & Record<keyof typeof STEPS, ReturnType<typeof vi.fn>>;
}

describe("runStage", () => {
  let bigquery: FakeBigQuery;
  let steps: ReturnType<typeof fakeSteps>;

  beforeEach(async () => {
    ({ bigquery } = await ingestTestbed());
    steps = fakeSteps();
    Object.assign(bigquery.tables, {
      videos: ["v1", "v2", "v3", "short"].map((video_id) => ({
        channel_id: CHANNEL,
        video_id,
        eligible: video_id !== "short",
      })),
      retention_coverage: [
        ["v1", "all", "complete"],
        ["v1", "organic", "complete"],
        ["v2", "subscribed", "complete"],
        ["v2", "all", "partial"],
        ["v3", "all", "insufficient_data"],
        ["short", "all", "complete"],
      ].map(([video_id, audience, status]) => ({
        channel_id: CHANNEL,
        video_id,
        audience,
        status,
      })),
    });
  });

  afterEach(resetTestbed);

  const run = (stage: Parameters<typeof runStage>[0], mode?: "build" | "refresh") =>
    runStage(stage, { channelId: CHANNEL, mode, now: NOW, log: quiet, steps });

  it("ingests every step of a build and records the video counts", async () => {
    const line = await run("ingest", "build");
    const order = ["ingestCatalogue", "ingestStats", "ingestMix", "ingestRetention"] as const;
    for (const name of order) expect(steps[name]).toHaveBeenCalledOnce();
    expect(steps.ingestStats).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: CHANNEL, publishedSince: undefined }),
    );
    // v1 and v2 have a complete curve; v3 does not; the Short is not eligible.
    expect(steps.recordBuildCounts).toHaveBeenCalledWith(CHANNEL, {
      eligibleVideos: 3,
      usableVideos: 2,
    });
    expect(line).toBe("ingest (build): 3 eligible videos, 2 usable");
  });

  it("refreshes the catalogue and the last 60 days of stats and retention, without the mix", async () => {
    await run("ingest", "refresh");
    expect(steps.ingestCatalogue).toHaveBeenCalledOnce();
    expect(steps.ingestMix).not.toHaveBeenCalled();
    for (const name of ["ingestStats", "ingestRetention"] as const) {
      expect(steps[name]).toHaveBeenCalledWith(
        expect.objectContaining({ publishedSince: "2026-08-11" }),
      );
    }
  });

  it("runs the other stages and reports what they did", async () => {
    expect(await run("extract")).toBe("extract: 1 extracted, 2 cached");
    expect(await run("extract-load")).toBe("extract-load: 3 videos, 20 beats");
    expect(await run("features")).toBe("features: 900 rows from 3 videos");
    expect(await run("baseline")).toBe("baseline: 3 videos (check), 3 curves");
    expect(await run("publish")).toBe("publish: not built yet (Phase 11)");
  });

  it("takes the channel, mode and run from the job environment", async () => {
    vi.stubEnv("CHANNEL_ID", CHANNEL);
    vi.stubEnv("BUILD_MODE", "refresh");
    vi.stubEnv("RUN_ID", "run-123");
    resetEnvCache();
    expect(stageTarget({})).toEqual({ channelId: CHANNEL, mode: "refresh", runId: "run-123" });
    expect(stageTarget({ mode: "build" }).mode).toBe("build");
  });

  it("needs a channel", () => {
    vi.stubEnv("CHANNEL_ID", "");
    resetEnvCache();
    expect(() => stageTarget({})).toThrow("No channel: pass --channel or set CHANNEL_ID");
  });

  it("counts eligible videos with a complete curve for a training audience", async () => {
    expect(await countVideos(CHANNEL)).toEqual({ eligibleVideos: 3, usableVideos: 2 });
  });
});
