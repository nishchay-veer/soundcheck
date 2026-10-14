import { describe, expect, it } from "vitest";
import { SAMPLE_SOUNDCHECK } from "@/app/styleguide/samples";
import {
  durationRange,
  isActive,
  percentRange,
  predictedSeries,
  soundcheckSteps,
  soundcheckTitle,
  unusableReasons,
} from "./soundcheck";

const progress = (
  step: "checking" | "watching" | "predicting" | "suggesting" | "finishing",
  message = "…",
) => ({ step, message, done: 0, total: 5 });
const statuses = (doc: Parameters<typeof soundcheckSteps>[0]) =>
  soundcheckSteps(doc).map((step) => step.status);

describe("soundcheck steps", () => {
  it("follow the job: done before its step, current at it, waiting after", () => {
    expect(statuses({ status: "queued", progress: null })).toEqual(Array(5).fill("waiting"));
    const steps = soundcheckSteps({
      status: "running",
      progress: progress("predicting", "Found 7 beats. Predicting how your audiences will watch"),
    });
    expect(steps.map((step) => step.status)).toEqual([
      "done",
      "done",
      "current",
      "waiting",
      "waiting",
    ]);
    expect(steps[2]?.message).toBe("Found 7 beats. Predicting how your audiences will watch");
    expect(statuses({ status: "failed", progress: progress("watching") })).toEqual([
      "done",
      "failed",
      "waiting",
      "waiting",
      "waiting",
    ]);
    expect(statuses({ status: "ready", progress: progress("finishing") })).toEqual(
      Array(5).fill("done"),
    );
  });

  it("keep polling only while the job has work left", () => {
    expect(["awaiting_upload", "queued", "running"].every((s) => isActive(s as never))).toBe(true);
    expect(isActive("ready") || isActive("failed")).toBe(false);
  });
});

describe("soundcheck numbers", () => {
  it("give ranges as clock times and whole percentages", () => {
    expect(durationRange({ p10: 70, p50: 82, p90: 95.4 })).toBe("1:22 (1:10 to 1:35)");
    expect(percentRange({ p10: 28.8, p50: 34.9, p90: 41.5 })).toBe("35% (29 to 42%)");
  });

  it("name a soundcheck by its title, else its file", () => {
    expect(soundcheckTitle(SAMPLE_SOUNDCHECK)).toBe("How I built a guitar in a weekend");
    expect(soundcheckTitle({ ...SAMPLE_SOUNDCHECK, title: "" })).toBe("guitar rough cut v3.mov");
    expect(soundcheckTitle({ title: "", input: { kind: "youtube", videoId: "lgxOjPdCGkw" } })).toBe(
      "Untitled cut",
    );
  });

  it("chart each predicted audience as a band, and say why it is not a result yet", () => {
    const prediction = SAMPLE_SOUNDCHECK.prediction ?? expect.fail("no prediction");
    expect(predictedSeries(prediction).map((s) => [s.key, s.actual, s.band?.p50.length])).toEqual([
      ["subscribed", null, 100],
      ["unsubscribed", null, 100],
    ]);
    expect(unusableReasons(prediction)).toEqual(["trained on 3 videos; at least 20 are needed"]);
  });
});
