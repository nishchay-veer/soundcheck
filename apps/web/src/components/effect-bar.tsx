import { cn } from "@soundcheck/ui/lib/utils";
import { IntervalText } from "./interval-text";

/**
 * One effect as a bar from a black zero line, with black whiskers for its
 * interval. `domain` is the largest absolute value on the shared scale, so
 * rows of one list compare. A clear effect is green or red; one whose interval
 * crosses zero is white and says "can't tell yet".
 */
export function EffectBar({
  label,
  delta,
  ci,
  domain,
}: {
  label: string;
  /** Null when the model never learned it (it never varied in the videos). */
  delta: number | null;
  ci: readonly [number, number] | null;
  domain: number;
}) {
  if (delta === null || ci === null) {
    return (
      <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-4">
        <span>{label}</span>
        <span className="text-sm text-ink-muted">Not learned: it never varies in your videos</span>
      </div>
    );
  }
  // The largest value reaches 96% of the half-width, so its whisker cap stays inside.
  const position = (value: number) => Math.min(100, Math.max(0, 50 + (value / domain) * 48));
  const clear = ci[0] > 0 || ci[1] < 0;
  const end = position(delta);
  return (
    <div className="grid gap-1 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] sm:items-center sm:gap-4">
      <span>{label}</span>
      <div className="flex flex-col gap-1">
        <div aria-hidden="true" className="relative h-7">
          <div
            className={cn(
              "absolute top-1 bottom-1 border-2 border-ink",
              !clear ? "bg-surface" : delta > 0 ? "bg-positive" : "bg-negative",
            )}
            style={{ left: `${Math.min(50, end)}%`, width: `${Math.abs(end - 50)}%` }}
          />
          <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-ink" />
          <div
            className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-ink"
            style={{ left: `${position(ci[0])}%`, width: `${position(ci[1]) - position(ci[0])}%` }}
          />
          {[ci[0], ci[1]].map((value, i) => (
            <div
              key={i}
              className="absolute top-1/2 h-3 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-ink"
              style={{ left: `${position(value)}%` }}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <IntervalText delta={delta} ci={ci} />
          {clear ? null : <span className="text-ink-muted">Can&apos;t tell yet</span>}
        </div>
      </div>
    </div>
  );
}
