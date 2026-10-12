"use client";

import { useState } from "react";
import { AutopsyChart } from "@/components/autopsy-chart";
import { formatClock } from "@/lib/format";
import { SAMPLE_BEATS, SAMPLE_DROPS, SAMPLE_SERIES } from "./samples";

/** The autopsy chart with sample data: clicking seeks a pretend player, arrows step between drop-offs. */
export function ChartDemo() {
  const [selected, setSelected] = useState<string | null>(SAMPLE_DROPS[0]?.id ?? null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  return (
    <div className="flex flex-col gap-3">
      <AutopsyChart
        id="sample"
        title="Who is still watching"
        durationS={212}
        series={SAMPLE_SERIES}
        beats={SAMPLE_BEATS}
        drops={SAMPLE_DROPS}
        selectedDropId={selected}
        onSelectDrop={(id) => {
          setSelected(id);
          setPlayhead(SAMPLE_DROPS.find((drop) => drop.id === id)?.startS ?? null);
        }}
        onSeek={setPlayhead}
        playheadS={playhead}
      />
      <p className="text-sm text-ink-muted">
        {playhead === null
          ? "Click the chart or the beats to seek."
          : `Seeked to ${formatClock(playhead)}.`}
      </p>
    </div>
  );
}
