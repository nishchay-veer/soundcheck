import type { VideoBeat } from "@soundcheck/core/schemas";
import { cn } from "@soundcheck/ui/lib/utils";
import { BEAT_LABELS, beatFill } from "@/lib/beats";
import { formatClock } from "@/lib/format";

/**
 * A video's beats as flat blocks, each as wide as its share of the video, on
 * the same left-to-right time as the retention chart. Openings are sky,
 * promotion sand, the rest white; every block is labelled.
 */
export function BeatStrip({
  beats,
  durationS,
}: {
  beats: readonly VideoBeat[];
  durationS: number;
}) {
  return (
    <ol
      aria-label="Beats"
      className="flex h-16 w-full overflow-hidden rounded-[4px] border-2 border-ink"
    >
      {beats.map((beat) => {
        const label = BEAT_LABELS[beat.beatType];
        return (
          <li
            key={beat.startS}
            title={`${label}, ${formatClock(beat.startS)} to ${formatClock(beat.endS)}: ${beat.summary}`}
            style={{ flex: `${Math.max(beat.endS - beat.startS, 0.5) / durationS} 1 0%` }}
            className={cn(
              "min-w-0 overflow-hidden border-r-2 border-ink px-1.5 py-1 text-xs leading-tight font-medium last:border-r-0",
              beatFill(beat.beatType),
            )}
          >
            <span className="block truncate">{label}</span>
            <span className="block truncate font-mono text-[11px]">{formatClock(beat.startS)}</span>
          </li>
        );
      })}
    </ol>
  );
}
