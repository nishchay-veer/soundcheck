import { cn } from "@soundcheck/ui/lib/utils";
import { formatInterval } from "@/lib/format";

/** An effect with its interval, e.g. "+4.2 pp (2.1 to 6.3)"; every number with an interval shows it. */
export function IntervalText({
  delta,
  ci,
  className,
}: {
  delta: number;
  ci: readonly [number, number];
  className?: string;
}) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {formatInterval(delta, ci)}
    </span>
  );
}
