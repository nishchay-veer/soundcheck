"use client";

import type { VideoBeat } from "@soundcheck/core/schemas";
import { useId, useState } from "react";
import { BEAT_GROUP_COLOR, BEAT_LABELS, beatGroup } from "@/lib/beats";
import { CHART, type Scales } from "@/lib/chart";
import type { BeatMark } from "@/lib/edits";
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
  marks,
}: {
  scales: Scales;
  durationS: number;
  beats: readonly VideoBeat[];
  onSeek: (seconds: number) => void;
  /** Edits shown on the beats, by beat index: hatched where cut, an arrow where moved. */
  marks?: ReadonlyMap<number, BeatMark>;
}) {
  const hatch = `${useId()}-cut`;
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
        {marks?.size ? (
          <defs>
            <pattern
              id={hatch}
              width="8"
              height="8"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="8"
                stroke="var(--ink)"
                strokeOpacity="0.35"
                strokeWidth="2"
              />
            </pattern>
          </defs>
        ) : null}
        {beats.map((beat, index) => {
          const left = x(beat.startS);
          const span = Math.max(1, x(beat.endS) - left);
          const group = beatGroup(beat.beatType);
          const name = BEAT_LABELS[beat.beatType];
          const mark = marks?.get(index);
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
              {mark && "cutFrom" in mark ? (
                <rect
                  data-cut={index}
                  x={left + span * mark.cutFrom}
                  y={4}
                  width={span * (1 - mark.cutFrom)}
                  height={height - 8}
                  fill={`url(#${hatch})`}
                  stroke="var(--ink)"
                  strokeWidth="2"
                />
              ) : null}
              {mark && "moved" in mark ? (
                <path
                  data-moved={index}
                  d={`M ${left + span - 22} ${height / 2} h 14 m -6 -6 l 6 6 l -6 6`}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
              {span > textWidth(name) + (mark ? 24 : 0) ? (
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
        {beats.map((beat, index) => (
          <li key={beat.startS}>
            {BEAT_LABELS[beat.beatType]}, {formatClock(beat.startS)} to {formatClock(beat.endS)}
            {markText(marks?.get(index))}: {beat.summary}
            {beat.transcriptExcerpt ? ` Said: “${beat.transcriptExcerpt}”` : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** How a mark reads to a screen reader. */
function markText(mark: BeatMark | undefined): string {
  if (!mark) return "";
  if ("moved" in mark) return " (moved)";
  return mark.cutFrom === 0
    ? " (cut)"
    : ` (cut after the first ${Math.round(mark.cutFrom * 100)}%)`;
}
