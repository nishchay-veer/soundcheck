import {
  AUDIENCE_LABELS,
  type Percentiles,
  type Scenario,
  type SoundcheckDoc,
  type SoundcheckKind,
  type SoundcheckPrediction,
  type SoundcheckStatus,
  type SoundcheckStep,
} from "@soundcheck/core/schemas";
import type { ChartSeries } from "@/components/retention-chart";
import type { StepStatus, StepView } from "./build-steps";
import { formatClock } from "./format";

/** How a soundcheck appears on its page and in the list (Phase 14). */

export const KIND_LABELS: Record<SoundcheckKind, string> = {
  file: "Uploaded file",
  youtube: "YouTube link",
};

export const STATUS_LABELS: Record<SoundcheckStatus, string> = {
  awaiting_upload: "Uploading",
  queued: "Starting",
  running: "Running",
  ready: "Ready",
  failed: "Failed",
};

/** Each scenario as the end of "Predicted with your channel's models, assuming …". */
export const SCENARIO_ASSUMPTIONS: Record<Scenario, string> = {
  recent: "the same mix of viewers as your recent videos",
  search: "most newcomers arrive from search",
  suggested: "most newcomers arrive from suggested videos",
  subscribers: "most views come from subscribers",
};

/** States in which the job has more to do, so the page keeps polling. */
export const isActive = (status: SoundcheckStatus): boolean =>
  status === "awaiting_upload" || status === "queued" || status === "running";

/** What a soundcheck is called: its working title, or its file's name. */
export function soundcheckTitle(doc: Pick<SoundcheckDoc, "title" | "input">): string {
  if (doc.title) return doc.title;
  return doc.input.kind === "file" ? doc.input.fileName : "Untitled cut";
}

const STEPS: readonly { key: SoundcheckStep; label: string }[] = [
  { key: "checking", label: "Checking your video" },
  { key: "watching", label: "Watching it" },
  { key: "predicting", label: "Predicting how each audience will watch" },
  { key: "suggesting", label: "Looking for edits" },
  { key: "finishing", label: "Writing it up" },
];

/**
 * The job's five steps, each done, current, waiting or failed. The current
 * step shows the job's own message ("Found 23 beats…"), and before the job
 * starts every step waits.
 */
export function soundcheckSteps(
  doc: Pick<SoundcheckDoc, "status" | "progress">,
): (StepView & { message: string | null })[] {
  const at = doc.progress ? STEPS.findIndex((step) => step.key === doc.progress?.step) : -1;
  const status = (index: number): StepStatus => {
    if (doc.status === "ready") return "done";
    if (at === -1) return "waiting";
    if (index < at) return "done";
    if (index > at) return "waiting";
    return doc.status === "failed" ? "failed" : "current";
  };
  return STEPS.map((step, index) => ({
    key: step.key,
    label: step.label,
    status: status(index),
    progress: null,
    message: index === at && doc.status === "running" ? (doc.progress?.message ?? null) : null,
  }));
}

/** The chart's series: each predicted audience as a band, with no measured line. */
export function predictedSeries(prediction: SoundcheckPrediction): ChartSeries[] {
  return (["subscribed", "unsubscribed"] as const).flatMap((key) => {
    const audience = prediction.audiences[key];
    return audience
      ? [{ key, label: AUDIENCE_LABELS[key], actual: null, band: audience.band }]
      : [];
  });
}

/** Average view duration with its range: "1:52 (1:40 to 2:05)". */
export const durationRange = ({ p10, p50, p90 }: Percentiles): string =>
  `${formatClock(p50)} (${formatClock(p10)} to ${formatClock(p90)})`;

/** Average view percentage with its range: "38% (32 to 44%)". */
export const percentRange = ({ p10, p50, p90 }: Percentiles): string =>
  `${Math.round(p50)}% (${Math.round(p10)} to ${Math.round(p90)}%)`;
