import type { BuildView } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { buildSteps, isBusy, timeLeft } from "./build-steps";

const statuses = (build: BuildView) => buildSteps(build).map((step) => step.status);

describe("buildSteps", () => {
  it("marks the steps before the running stage done and the rest waiting", () => {
    expect(statuses({ state: "queued" })).toEqual([
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses({ state: "running", stage: "ingest" })).toEqual([
      "current",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses({ state: "running", stage: "extract-load" })).toEqual([
      "done",
      "current",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses({ state: "running", stage: "evaluate" })).toEqual([
      "done",
      "done",
      "done",
      "current",
      "waiting",
    ]);
    expect(statuses({ state: "ready", stage: "publish" })).toEqual([
      "done",
      "done",
      "done",
      "done",
      "done",
    ]);
  });

  it("marks where a build failed, and what a build with too few videos never ran", () => {
    expect(statuses({ state: "failed", stage: "train", error: "train: …" })).toEqual([
      "done",
      "done",
      "failed",
      "waiting",
      "waiting",
    ]);
    // A workflow that never started has no stage to blame.
    expect(statuses({ state: "failed", stage: "start" })).toEqual([
      "waiting",
      "waiting",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses({ state: "insufficient_data", stage: "ingest" })).toEqual([
      "done",
      "skipped",
      "skipped",
      "skipped",
      "skipped",
    ]);
  });

  it("gives the current step its job's progress, and no other step", () => {
    const steps = buildSteps({
      state: "running",
      stage: "extract",
      progress: {
        stage: "extract",
        done: 12,
        total: 40,
        etaS: 210,
        updatedAt: "2026-10-12T09:00:00.000Z",
      },
    });
    expect(steps[1]?.progress).toEqual({ done: 12, total: 40, etaS: 210 });
    expect(steps.filter((step) => step.progress)).toHaveLength(1);
    // Progress left over from an earlier stage is not shown on the next one.
    const stale = buildSteps({
      state: "running",
      stage: "features",
      progress: { stage: "extract", done: 40, total: 40, updatedAt: "2026-10-12T09:00:00.000Z" },
    });
    expect(stale.every((step) => step.progress === null)).toBe(true);
  });

  it("keeps polling only while the build is queued or running", () => {
    expect(["queued", "running"].map((state) => isBusy({ state } as BuildView))).toEqual([
      true,
      true,
    ]);
    for (const state of ["not_started", "ready", "failed", "insufficient_data"] as const) {
      expect(isBusy({ state })).toBe(false);
    }
  });
});

describe("timeLeft", () => {
  it("says time left in round words", () => {
    expect(timeLeft(42)).toBe("under a minute left");
    expect(timeLeft(80)).toBe("about 1 minute left");
    expect(timeLeft(250)).toBe("about 4 minutes left");
    expect(timeLeft(7300)).toBe("about 2 hours left");
  });
});
