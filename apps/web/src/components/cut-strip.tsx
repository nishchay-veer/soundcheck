"use client";

import type { VideoBeat } from "@soundcheck/core/schemas";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { useMemo } from "react";
import { CHART, chartScales } from "@/lib/chart";
import type { BeatMark } from "@/lib/edits";
import { useResizeObserver } from "@/lib/use-resize-observer";
import { BeatStrip } from "./beat-strip";

/**
 * The cut as it is, on its own time scale, with what the ticked edits do to
 * it: hatched where something is cut, an arrow where a beat moves.
 */
export function CutStrip({
  beats,
  durationS,
  marks,
  onSeek,
}: {
  beats: readonly VideoBeat[];
  durationS: number;
  marks: ReadonlyMap<number, BeatMark>;
  onSeek: (seconds: number) => void;
}) {
  const [ref, measured] = useResizeObserver<HTMLDivElement>(CHART.minWidth);
  const scales = useMemo(() => chartScales(measured, durationS), [measured, durationS]);
  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm text-ink-muted">
        Your cut as it is: hatched parts are cut, an arrow marks a beat that moves.
      </figcaption>
      <div
        ref={ref}
        tabIndex={0}
        aria-label="Your cut as it is, with the ticked edits"
        className={cn("overflow-x-auto rounded-[4px] border-2 border-ink bg-surface", FOCUS_RING)}
      >
        <div style={{ width: scales.width }}>
          <BeatStrip
            scales={scales}
            durationS={durationS}
            beats={beats}
            onSeek={onSeek}
            marks={marks}
          />
        </div>
      </div>
    </figure>
  );
}
