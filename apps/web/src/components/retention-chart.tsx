"use client";

import type { AudienceKey } from "@soundcheck/core/schemas";
import { useMemo, type MouseEvent } from "react";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import { CHART, bandPath, curvePath, timeTicks, type Scales } from "@/lib/chart";
import { formatClock } from "@/lib/format";

/** One audience's measured curve and predicted band: share still watching at the end of each of 100 bins. */
export interface ChartSeries {
  key: AudienceKey;
  label: string;
  actual: readonly number[] | null;
  band: { p10: readonly number[]; p50: readonly number[]; p90: readonly number[] } | null;
}

/** A drop-off window on the chart. */
export interface ChartDrop {
  id: string;
  audience: AudienceKey;
  startS: number;
  endS: number;
}

/** Seconds at a pointer event's x, from the scale (the SVG is drawn at its pixel width). */
export function secondsAt(event: MouseEvent<Element>, scales: Scales, durationS: number): number {
  const box = event.currentTarget.getBoundingClientRect();
  return Math.min(durationS, Math.max(0, scales.x.invert(event.clientX - box.left)));
}

/**
 * Retention in the design system's chart language, on the shared scales: a
 * white plot with 2px black axes and dashed gridlines; each measured curve a
 * 3px line in its audience's color over a 6px black underlay; each predicted
 * median a 2px dashed black line in a 10th-to-90th percentile band (hidden
 * with `showModel` off); drop-off windows hatched over a light red, darker
 * when hovered and outlined when selected. Clicking seeks to that second.
 */
export function RetentionChart({
  id,
  label,
  scales,
  durationS,
  series,
  showModel,
  drops,
  selectedDropId,
  hoveredDropId,
  onHoverDrop,
  onSelectDrop,
  onSeek,
  playheadS,
}: {
  id: string;
  label: string;
  scales: Scales;
  durationS: number;
  series: readonly ChartSeries[];
  showModel: boolean;
  drops: readonly ChartDrop[];
  selectedDropId: string | null;
  hoveredDropId: string | null;
  onHoverDrop: (id: string | null) => void;
  onSelectDrop: (id: string) => void;
  onSeek: (seconds: number) => void;
  playheadS?: number | null;
}) {
  const { x, y, width } = scales;
  const { margin, plotHeight } = CHART;
  const paths = useMemo(
    () =>
      series.map((s) => ({
        key: s.key,
        actual: s.actual ? curvePath(s.actual, durationS, scales) : null,
        median: s.band ? curvePath(s.band.p50, durationS, scales) : null,
        band: s.band ? bandPath(s.band.p10, s.band.p90, durationS, scales) : null,
      })),
    [series, durationS, scales],
  );
  const ticks = useMemo(() => timeTicks(durationS), [durationS]);
  const hatch = `${id}-hatch`;
  return (
    <svg
      width={width}
      height={plotHeight}
      role="img"
      aria-label={label}
      className="block cursor-crosshair"
      onClick={(event) => onSeek(secondsAt(event, scales, durationS))}
    >
      <defs>
        <pattern
          id={hatch}
          width="8"
          height="8"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--ink)" strokeWidth="1.5" />
        </pattern>
      </defs>
      {[25, 50, 75, 100].map((percent) => (
        <line
          key={percent}
          x1={x(0)}
          x2={x(durationS)}
          y1={y(percent)}
          y2={y(percent)}
          stroke="var(--rule)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      ))}
      {drops.map((drop) => {
        const left = x(drop.startS);
        const span = Math.max(2, x(drop.endS) - left);
        const selected = drop.id === selectedDropId;
        return (
          <g
            key={drop.id}
            data-drop={drop.id}
            className="cursor-pointer"
            onPointerEnter={() => onHoverDrop(drop.id)}
            onPointerLeave={() => onHoverDrop(null)}
            onClick={(event) => {
              event.stopPropagation();
              onSelectDrop(drop.id);
            }}
          >
            <rect
              x={left}
              y={margin.top}
              width={span}
              height={plotHeight - margin.top - margin.bottom}
              fill="var(--negative)"
              fillOpacity={selected || drop.id === hoveredDropId ? 0.3 : 0.15}
            />
            <rect
              x={left}
              y={margin.top}
              width={span}
              height={plotHeight - margin.top - margin.bottom}
              fill={`url(#${hatch})`}
              opacity="0.5"
              stroke={selected ? "var(--ink)" : "none"}
              strokeWidth="2"
            />
          </g>
        );
      })}
      {showModel
        ? paths.map((p) =>
            p.band && p.median ? (
              <g key={`${p.key}-model`} pointerEvents="none">
                <path
                  className="transition-[d] duration-300 ease-out motion-reduce:transition-none"
                  d={p.band}
                  fill={AUDIENCE_COLOR[p.key]}
                  fillOpacity="0.35"
                  stroke="var(--ink)"
                  strokeWidth="1"
                />
                <path
                  className="transition-[d] duration-300 ease-out motion-reduce:transition-none"
                  d={p.median}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2"
                  strokeDasharray="6 4"
                />
              </g>
            ) : null,
          )
        : null}
      {paths.map((p) =>
        p.actual ? (
          <g key={`${p.key}-actual`} pointerEvents="none" data-curve={p.key}>
            <path
              className="transition-[d] duration-300 ease-out motion-reduce:transition-none"
              d={p.actual}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              className="transition-[d] duration-300 ease-out motion-reduce:transition-none"
              d={p.actual}
              fill="none"
              stroke={AUDIENCE_COLOR[p.key]}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ) : null,
      )}
      {playheadS !== null && playheadS !== undefined ? (
        <line
          x1={x(playheadS)}
          x2={x(playheadS)}
          y1={margin.top}
          y2={y(0)}
          stroke="var(--ink)"
          strokeWidth="2"
          pointerEvents="none"
        />
      ) : null}
      <line x1={x(0)} x2={x(0)} y1={y(100)} y2={y(0)} stroke="var(--ink)" strokeWidth="2" />
      <line x1={x(0)} x2={x(durationS)} y1={y(0)} y2={y(0)} stroke="var(--ink)" strokeWidth="2" />
      {[0, 25, 50, 75, 100].map((percent) => (
        <text
          key={percent}
          x={x(0) - 8}
          y={y(percent)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="13"
          fill="var(--ink)"
        >
          {percent}%
        </text>
      ))}
      {ticks.map((t) => (
        <text
          key={t}
          x={x(t)}
          y={y(0) + 22}
          textAnchor="middle"
          fontSize="13"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
        >
          {formatClock(t)}
        </text>
      ))}
    </svg>
  );
}
