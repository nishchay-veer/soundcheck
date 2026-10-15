import { STAGE_ATTEMPTS } from "@soundcheck/core/schemas";
import { Progress } from "@soundcheck/ui/components/progress";
import { cn } from "@soundcheck/ui/lib/utils";
import { Check, Minus, X } from "lucide-react";
import { formatCount } from "@/lib/format";
import { timeLeft, timeSoFar, type StepStatus, type StepView } from "@/lib/build-steps";

const SPOKEN: Record<StepStatus, string> = {
  done: "done",
  current: "in progress",
  waiting: "waiting",
  failed: "failed",
  skipped: "not run",
};

function Mark({ status, number }: { status: StepStatus; number: number }) {
  const base =
    "flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink text-sm font-bold";
  if (status === "done")
    return (
      <span aria-hidden="true" className={cn(base, "bg-surface")}>
        <Check className="size-4" />
      </span>
    );
  if (status === "failed")
    return (
      <span aria-hidden="true" className={cn(base, "bg-negative")}>
        <X className="size-4" />
      </span>
    );
  if (status === "skipped")
    return (
      <span aria-hidden="true" className={cn(base, "border-ink-muted text-ink-muted")}>
        <Minus className="size-4" />
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={cn(base, status === "current" ? "bg-accent" : "bg-bg text-ink-muted")}
    >
      {number}
    </span>
  );
}

/** The five build steps, with the current one's progress and time left. */
export function BuildProgress({ steps }: { steps: readonly StepView[] }) {
  return (
    <ol className="flex flex-col gap-3">
      {steps.map((step, index) => {
        const counted = step.progress && step.progress.total > 0;
        return (
          <li
            key={step.key}
            aria-current={step.status === "current" ? "step" : undefined}
            className={cn(
              "flex flex-col gap-3 rounded-[4px] border-2 p-4",
              step.status === "current" || step.status === "failed"
                ? "border-ink bg-surface"
                : "border-transparent",
            )}
          >
            <div className="flex items-center gap-3">
              <Mark status={step.status} number={index + 1} />
              <span
                className={cn(
                  step.status === "waiting" || step.status === "skipped"
                    ? "text-ink-muted"
                    : "font-medium",
                )}
              >
                {step.label}
                {counted && step.progress && !step.detail ? (
                  <span className="tabular-nums">
                    , {formatCount(step.progress.done)} of {formatCount(step.progress.total)}
                  </span>
                ) : null}
                <span className="sr-only">: {SPOKEN[step.status]}</span>
              </span>
            </div>
            {step.status === "current" ? (
              <div className="flex flex-col gap-1.5 pl-11">
                <Progress
                  value={
                    counted && step.progress
                      ? (step.progress.done / step.progress.total) * 100
                      : null
                  }
                  aria-label={step.label}
                />
                {step.attempt ? (
                  <span className="text-sm font-medium">
                    Something went wrong, so this is running again: attempt {step.attempt} of{" "}
                    {STAGE_ATTEMPTS}
                  </span>
                ) : null}
                {step.detail ? <span className="text-sm">{step.detail}</span> : null}
                <span className="text-sm text-ink-muted">
                  {step.progress?.etaS !== undefined
                    ? timeLeft(step.progress.etaS)
                    : step.elapsedS !== null && step.elapsedS !== undefined
                      ? timeSoFar(step.elapsedS)
                      : "Working…"}
                </span>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
