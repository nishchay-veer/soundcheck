import type { AudienceKey } from "@soundcheck/core/schemas";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import { formatClock } from "@/lib/format";

/** One audience's measured curve and predicted band: survival at the end of each of 100 bins. */
export interface ChartSeries {
  key: AudienceKey;
  label: string;
  actual: readonly number[] | null;
  band: { p10: readonly number[]; p50: readonly number[]; p90: readonly number[] } | null;
}

/** A plot's size in its own units; text is 13 units high in both. */
interface Size {
  width: number;
  height: number;
}
/** The wide plot for tablets and up; the narrow one keeps labels readable on a phone. */
const WIDE: Size = { width: 720, height: 340 };
const NARROW: Size = { width: 400, height: 300 };
const MARGIN = { top: 16, right: 16, bottom: 40, left: 52 };

function scales({ width, height }: Size) {
  const plotW = width - MARGIN.left - MARGIN.right;
  const plotH = height - MARGIN.top - MARGIN.bottom;
  const x = (t: number) => MARGIN.left + t * plotW;
  const y = (share: number) => MARGIN.top + (1 - share) * plotH;
  /** Everyone watches at time 0; bin b ends at b% of the video. */
  const points = (curve: readonly number[]) => [
    [0, 1] as const,
    ...curve.map((share, i) => [(i + 1) / curve.length, share] as const),
  ];
  const line = (curve: readonly number[]) =>
    points(curve)
      .map(([t, share], i) => `${i ? "L" : "M"}${x(t).toFixed(1)},${y(share).toFixed(1)}`)
      .join("");
  const area = (low: readonly number[], high: readonly number[]) =>
    `${line(high)}${points(low)
      .reverse()
      .map(([t, share]) => `L${x(t).toFixed(1)},${y(share).toFixed(1)}`)
      .join("")}Z`;
  return { plotH, x, y, line, area };
}

/**
 * Retention in the design system's chart language: a white plot with 2px
 * black axes and dashed gridlines; each measured curve a 3px line in its
 * audience's color over a 6px black underlay; each predicted median a 2px
 * dashed black line in a 10th-to-90th percentile band (the audience color at
 * 35%, outlined in black); drop-off windows hatched over a light red. `id`
 * keeps this chart's hatch pattern apart from others on the page.
 */
export function RetentionChart({
  id,
  title,
  series,
  durationS,
  drops = [],
}: {
  id: string;
  title: string;
  series: readonly ChartSeries[];
  durationS: number;
  drops?: readonly { binStart: number; binEnd: number }[];
}) {
  const hatch = `${id}-hatch`;
  const summary = series
    .filter((s) => s.actual)
    .map(
      (s) => `${s.label}: ${Math.round((s.actual?.at(-1) ?? 0) * 100)}% still watching at the end`,
    )
    .join("; ");
  const label = `${title}. ${summary}.`;
  return (
    <figure className="flex flex-col gap-3">
      <figcaption className="font-heading text-xl font-bold">{title}</figcaption>
      <div className="rounded-[4px] border-2 border-ink bg-surface p-2">
        <Plot
          size={NARROW}
          label={label}
          hatch={`${hatch}-narrow`}
          series={series}
          durationS={durationS}
          drops={drops}
          className="sm:hidden"
        />
        <Plot
          size={WIDE}
          label={label}
          hatch={`${hatch}-wide`}
          series={series}
          durationS={durationS}
          drops={drops}
          className="hidden sm:block"
        />
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-1.5 w-6 rounded-full border border-ink"
              style={{ background: AUDIENCE_COLOR[s.key] }}
            />
            {s.label}
          </li>
        ))}
        {series.some((s) => s.band) ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="w-6 border-t-2 border-dashed border-ink" />
            Predicted median, in a 10th to 90th percentile band
          </li>
        ) : null}
        {drops.length ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-6 border border-ink bg-negative/15" />
            Drop-off
          </li>
        ) : null}
      </ul>
    </figure>
  );
}

function Plot({
  size,
  label,
  hatch,
  series,
  durationS,
  drops,
  className,
}: {
  size: Size;
  label: string;
  hatch: string;
  series: readonly ChartSeries[];
  durationS: number;
  drops: readonly { binStart: number; binEnd: number }[];
  className: string;
}) {
  const { plotH, x, y, line, area } = scales(size);
  return (
    <svg
      viewBox={`0 0 ${size.width} ${size.height}`}
      role="img"
      aria-label={label}
      className={`h-auto w-full ${className}`}
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
      {drops.map((drop) => {
        const left = x((drop.binStart - 1) / 100);
        const width = x(drop.binEnd / 100) - left;
        return (
          <g key={`${drop.binStart}-${drop.binEnd}`}>
            <rect
              x={left}
              y={MARGIN.top}
              width={width}
              height={plotH}
              fill="var(--negative)"
              fillOpacity="0.15"
            />
            <rect
              x={left}
              y={MARGIN.top}
              width={width}
              height={plotH}
              fill={`url(#${hatch})`}
              opacity="0.5"
            />
          </g>
        );
      })}
      {[0.25, 0.5, 0.75, 1].map((share) => (
        <line
          key={share}
          x1={x(0)}
          x2={x(1)}
          y1={y(share)}
          y2={y(share)}
          stroke="var(--rule)"
          strokeWidth="1"
          strokeDasharray="4 4"
        />
      ))}
      {series.map((s) =>
        s.band ? (
          <g key={`${s.key}-band`}>
            <path
              d={area(s.band.p10, s.band.p90)}
              fill={AUDIENCE_COLOR[s.key]}
              fillOpacity="0.35"
              stroke="var(--ink)"
              strokeWidth="1"
            />
            <path
              d={line(s.band.p50)}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="2"
              strokeDasharray="6 4"
            />
          </g>
        ) : null,
      )}
      {series.map((s) =>
        s.actual ? (
          <g key={`${s.key}-actual`}>
            <path
              d={line(s.actual)}
              fill="none"
              stroke="var(--ink)"
              strokeWidth="6"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
            <path
              d={line(s.actual)}
              fill="none"
              stroke={AUDIENCE_COLOR[s.key]}
              strokeWidth="3"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          </g>
        ) : null,
      )}
      <line x1={x(0)} x2={x(0)} y1={y(1)} y2={y(0)} stroke="var(--ink)" strokeWidth="2" />
      <line x1={x(0)} x2={x(1)} y1={y(0)} y2={y(0)} stroke="var(--ink)" strokeWidth="2" />
      {[0, 0.25, 0.5, 0.75, 1].map((share) => (
        <text
          key={share}
          x={x(0) - 8}
          y={y(share)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize="13"
          fill="var(--ink)"
        >
          {Math.round(share * 100)}%
        </text>
      ))}
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <text
          key={t}
          x={x(t)}
          y={y(0) + 22}
          textAnchor="middle"
          fontSize="13"
          fill="var(--ink)"
          fontFamily="var(--font-mono)"
        >
          {formatClock(t * durationS)}
        </text>
      ))}
    </svg>
  );
}
