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

export type StepStatus = "done" | "current" | "waiting" | "failed" | "skipped";

export interface StepView {
  key: (typeof BUILD_STEPS)[number]["key"];
  label: string;
  status: StepStatus;
  /** How far the current step has got, when its job reports it. */
  progress: { done: number; total: number; etaS?: number } | null;
}

/** States in which the build is still at work, so the screen keeps polling. */
export const isBusy = (build: Pick<BuildView, "state">): boolean =>
  build.state === "queued" || build.state === "running";

/** Each step's status for a build, and the current step's progress. */
export function buildSteps(build: BuildView): StepView[] {
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

/** Time left in words: "under a minute", "about 4 minutes", "about 2 hours". */
export function timeLeft(seconds: number): string {
  if (seconds < 60) return "under a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 90) return `about ${minutes} minute${minutes === 1 ? "" : "s"} left`;
  const hours = Math.round(minutes / 60);
  return `about ${hours} hours left`;
}
