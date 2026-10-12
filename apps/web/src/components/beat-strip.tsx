"use client";

import type { VideoBeat } from "@soundcheck/core/schemas";
import { useState } from "react";
import { BEAT_GROUP_COLOR, BEAT_LABELS, beatGroup } from "@/lib/beats";
import { CHART, type Scales } from "@/lib/chart";
import { formatClock } from "@/lib/format";
import { secondsAt } from "./retention-chart";

/** Roughly how wide a label is at 12px, to show only labels that fit their block. */
const textWidth = (text: string) => text.length * 6.6 + 10;

/**
 * A video's beats as flat blocks on the chart's own time scale, colored by
 * group (tangents get a dashed outline). Hovering shows a beat's summary and
 * the start of what is said; clicking seeks to that second. Screen readers get
 * the beats as a list.
 */
export function BeatStrip({
  scales,
  durationS,
  beats,
  onSeek,
}: {
  scales: Scales;
  durationS: number;
  beats: readonly VideoBeat[];
  onSeek: (seconds: number) => void;
}) {
  const { x, width } = scales;
  const [hover, setHover] = useState<number | null>(null);
  const height = CHART.stripHeight;
  const shown = hover === null ? null : beats[hover];
  return (
    <div className="relative">
      <svg
        width={width}
        height={height}
        aria-hidden="true"
        className="block cursor-crosshair"
        onClick={(event) => onSeek(secondsAt(event, scales, durationS))}
        onPointerLeave={() => setHover(null)}
      >
        {beats.map((beat, index) => {
          const left = x(beat.startS);
          const span = Math.max(1, x(beat.endS) - left);
          const group = beatGroup(beat.beatType);
          const name = BEAT_LABELS[beat.beatType];
          return (
            <g key={beat.startS} data-beat={beat.startS} onPointerEnter={() => setHover(index)}>
              <rect
                x={left}
                y={4}
                width={span}
                height={height - 8}
                fill={BEAT_GROUP_COLOR[group]}
                stroke="var(--ink)"
                strokeWidth="2"
              />
              {group === "tangent" ? (
                <rect
                  x={left + 5}
                  y={9}
                  width={Math.max(0, span - 10)}
                  height={height - 18}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeDasharray="5 4"
                />
              ) : null}
              {span > textWidth(name) ? (
                <text
                  x={left + 6}
                  y={height / 2 + 4}
                  fontSize="12"
                  fontWeight="500"
                  fill="var(--ink)"
                  pointerEvents="none"
                >
                  {name}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      {shown ? (
        <div
          role="tooltip"
          className="pointer-events-none absolute bottom-full z-10 mb-2 w-72 rounded-[4px] border-2 border-ink bg-surface p-3 text-sm"
          style={{ left: Math.min(Math.max(0, x(shown.startS)), width - 288) }}
        >
          <p className="font-medium">
            {BEAT_LABELS[shown.beatType]}{" "}
            <span className="font-mono text-xs">
              {formatClock(shown.startS)}–{formatClock(shown.endS)}
            </span>
          </p>
          <p>{shown.summary}</p>
          {shown.transcriptExcerpt ? (
            <p className="mt-1 text-ink-muted">“{shown.transcriptExcerpt}”</p>
          ) : null}
        </div>
      ) : null}
      <ol className="sr-only" aria-label="Beats">
        {beats.map((beat) => (
          <li key={beat.startS}>
            {BEAT_LABELS[beat.beatType]}, {formatClock(beat.startS)} to {formatClock(beat.endS)}:{" "}
            {beat.summary}
            {beat.transcriptExcerpt ? ` Said: “${beat.transcriptExcerpt}”` : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}
