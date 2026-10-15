import type { BuildView } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { buildSteps, isBusy, timeLeft, timeSoFar } from "./build-steps";

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

  it("says what the current stage is doing, with what it counts", () => {
    const at = (stage: string, progress?: { done: number; total: number }) =>
      buildSteps({
        state: "running",
        stage,
        ...(progress
          ? { progress: { stage, ...progress, updatedAt: "2026-10-16T09:00:00.000Z" } }
          : {}),
      }).find((step) => step.status === "current")?.detail;
    expect(at("extract-load", { done: 12, total: 69 })).toBe(
      "Saving what Gemini found · 12 of 69 videos",
    );
    expect(at("baseline", { done: 3, total: 7 })).toBe(
      "Asking Gemini to guess each video's curve, to compare the model against · 3 of 7 videos",
    );
    expect(at("publish", { done: 2, total: 5 })).toBe("Writing your screens' captions · 2 of 5");
    // Before a counting stage's job reports, it is still starting up.
    expect(at("evaluate")).toBe("Getting ready…");
    // Features counts nothing: it says what it does from the start.
    expect(at("features")).toBe("Preparing your videos' data for the model");
    // Nothing for a step that is not running.
    expect(buildSteps({ state: "failed", stage: "baseline" }).every((step) => !step.detail)).toBe(
      true,
    );
  });

  it("says how long the current stage has been running, from when the workflow started it", () => {
    const started = Date.parse("2026-10-16T09:00:00.000Z");
    const steps = buildSteps(
      { state: "running", stage: "baseline", stageStartedAt: "2026-10-16T09:00:00.000Z" },
      started + 4 * 60_000 + 20_000,
    );
    expect(steps.find((step) => step.status === "current")?.elapsedS).toBe(260);
    expect(steps.filter((step) => step.elapsedS !== null)).toHaveLength(1);
    // Without the time, or before the page knows it, no elapsed time.
    expect(buildSteps({ state: "running", stage: "baseline" }, started)[3]?.elapsedS).toBeNull();
    expect(
      buildSteps({
        state: "running",
        stage: "baseline",
        stageStartedAt: "2026-10-16T09:00:00.000Z",
      })[3]?.elapsedS,
    ).toBeNull();
  });

  it("says when the current stage is being tried again", () => {
    const at = (stageAttempt?: number) =>
      buildSteps({
        state: "running",
        stage: "evaluate",
        ...(stageAttempt ? { stageAttempt } : {}),
      })[3]?.attempt;
    expect(at()).toBeNull();
    expect(at(1)).toBeNull();
    expect(at(2)).toBe(2);
    expect(at(3)).toBe(3);
    // Not once the build has failed: the screen says so instead.
    expect(
      buildSteps({ state: "failed", stage: "evaluate", stageAttempt: 3 }).every(
        (step) => !step.attempt,
      ),
    ).toBe(true);
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

describe("timeSoFar", () => {
  it("says time so far in plain words", () => {
    expect(timeSoFar(30)).toBe("under a minute so far");
    expect(timeSoFar(60)).toBe("1 minute so far");
    expect(timeSoFar(14 * 60 + 50)).toBe("14 minutes so far");
    expect(timeSoFar(65 * 60)).toBe("1 h 5 min so far");
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
