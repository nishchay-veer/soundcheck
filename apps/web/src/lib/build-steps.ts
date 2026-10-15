import type { BuildView } from "@soundcheck/core/schemas";

/**
 * The build as a creator sees it: five steps over the pipeline's eight
 * stages. Collecting the videos and measuring each audience happen in one
 * stage (ingest), so they are one step.
 */
export const BUILD_STEPS = [
  {
    key: "collect",
    label: "Collecting your videos and how each audience watched",
    stages: ["ingest"],
  },
  { key: "watch", label: "Watching your videos", stages: ["extract", "extract-load"] },
  { key: "learn", label: "Learning your audiences", stages: ["features", "train"] },
  { key: "check", label: "Checking our accuracy", stages: ["baseline", "evaluate"] },
  { key: "publish", label: "Publishing your screens", stages: ["publish"] },
] as const;

/**
 * What each pipeline stage is doing, in a line under its step. A stage that
 * counts says what (`unit`); until its job reports, it is still starting up.
 */
export const STAGE_TEXT: Record<string, { text: string; counts: boolean; unit?: string }> = {
  ingest: { text: "Asking YouTube for your videos and their numbers", counts: true },
  extract: { text: "Gemini is watching your videos", counts: true, unit: "videos" },
  "extract-load": { text: "Saving what Gemini found", counts: true, unit: "videos" },
  features: { text: "Preparing your videos' data for the model", counts: false },
  train: { text: "Fitting a model for each audience", counts: true, unit: "audiences" },
  baseline: {
    text: "Asking Gemini to guess each video's curve, to compare the model against",
    counts: true,
    unit: "videos",
  },
  evaluate: {
    text: "Testing each audience's model on videos it didn't see",
    counts: true,
    unit: "audiences",
  },
  publish: { text: "Writing your screens' captions", counts: true },
};

export type StepStatus = "done" | "current" | "waiting" | "failed" | "skipped";

export interface StepView {
  /** A build step's key, or a soundcheck's (Phase 14 reuses the list). */
  key: string;
  label: string;
  status: StepStatus;
  /** How far the current step has got, when its job reports it. */
  progress: { done: number; total: number; etaS?: number } | null;
  /** The current step's stage in words, with its count: "Saving what Gemini found · 12 of 69 videos". */
  detail?: string | null;
  /** Seconds the current step's stage has been running, when known. */
  elapsedS?: number | null;
  /** The attempt at the current step's stage, when it is being tried again (2 or more). */
  attempt?: number | null;
}

/** States in which the build is still at work, so the screen keeps polling. */
export const isBusy = (build: Pick<BuildView, "state">): boolean =>
  build.state === "queued" || build.state === "running";

/** The current stage in words: what it is doing, its count, or that its job is still starting. */
function stageDetail(build: BuildView): string | null {
  const text = STAGE_TEXT[build.stage ?? ""];
  if (!text) return null;
  if (!text.counts) return text.text;
  const progress = build.progress?.stage === build.stage ? build.progress : undefined;
  if (!progress || progress.total === 0) return "Getting ready…";
  return `${text.text} · ${progress.done} of ${progress.total}${text.unit ? ` ${text.unit}` : ""}`;
}

/**
 * Each step's status for a build, and the current step's progress, what its
 * stage is doing and, given `now`, how long it has been running.
 */
export function buildSteps(build: BuildView, now?: number): StepView[] {
  const started = build.stageStartedAt ? Date.parse(build.stageStartedAt) : Number.NaN;
  const elapsedS =
    now === undefined || Number.isNaN(started) ? null : Math.max(0, (now - started) / 1000);
  const at = BUILD_STEPS.findIndex((step) =>
    (step.stages as readonly string[]).includes(build.stage ?? ""),
  );
  const status = (index: number): StepStatus => {
    switch (build.state) {
      case "ready":
        return "done";
      case "running":
        return index < Math.max(at, 0) ? "done" : index === Math.max(at, 0) ? "current" : "waiting";
      case "failed":
        if (at < 0) return "waiting";
        return index < at ? "done" : index === at ? "failed" : "waiting";
      case "insufficient_data":
        // The build stopped after collecting: too few usable videos to go on.
        return index === 0 ? "done" : "skipped";
      default:
        return "waiting";
    }
  };
  return BUILD_STEPS.map((step, index) => {
    const own = build.progress && (step.stages as readonly string[]).includes(build.progress.stage);
    const current = status(index) === "current";
    return {
      key: step.key,
      label: step.label,
      status: status(index),
      detail: current && build.state === "running" ? stageDetail(build) : null,
      elapsedS: current && build.state === "running" ? elapsedS : null,
      attempt:
        current && build.state === "running" && (build.stageAttempt ?? 1) > 1
          ? (build.stageAttempt ?? null)
          : null,
      progress:
        current && own && build.progress
          ? {
              done: build.progress.done,
              total: build.progress.total,
              ...(build.progress.etaS === undefined ? {} : { etaS: build.progress.etaS }),
            }
          : null,
    };
  });
}

/** Time so far in words: "under a minute so far", "4 minutes so far", "1 h 5 min so far". */
export function timeSoFar(seconds: number): string {
  if (seconds < 60) return "under a minute so far";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} so far`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min so far`;
}

/** Time left in words: "under a minute", "about 4 minutes", "about 2 hours". */
export function timeLeft(seconds: number): string {
  if (seconds < 60) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hours left`;
}
