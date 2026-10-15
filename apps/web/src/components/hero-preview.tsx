import { Badge } from "@soundcheck/ui/components/badge";
import { area, line } from "d3-shape";
import { Check } from "lucide-react";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import { BEAT_GROUP_COLOR } from "@/lib/beats";
import { formatClock } from "@/lib/format";

/**
 * The landing page's picture of a soundcheck: an example 5-minute cut with
 * three edits ticked, drawn like the real screen (each audience's predicted
 * band and median over the beat strip, moved beats marked with an arrow). The
 * numbers are the Phase 15 demo's; the curves only illustrate them.
 */

const DURATION_S = 300;
const VIEW = { width: 520, height: 248 };
const PLOT = { left: 44, right: 508, top: 12, bottom: 172 };
const STRIP = { top: 200, height: 40 };

const x = (seconds: number) => PLOT.left + (seconds / DURATION_S) * (PLOT.right - PLOT.left);
const y = (share: number) => PLOT.bottom - share * (PLOT.bottom - PLOT.top);

/** A smooth predicted curve: an early drop, then a steady leak. */
function curve(stay: number, settle: number, leak: number) {
  return Array.from({ length: 61 }, (_, i) => {
    const t = (i / 60) * DURATION_S;
    const median = (stay + (1 - stay) * Math.exp(-t / settle)) * Math.exp(-leak * t);
    const spread = 0.015 + 0.05 * (t / DURATION_S);
    return { t, low: Math.max(0, median - spread), median, high: Math.min(1, median + spread) };
  });
}

const AUDIENCES = [
  { key: "subscribed", points: curve(0.9, 6, 0.0021) },
  { key: "unsubscribed", points: curve(0.72, 9, 0.0035) },
] as const;

const band = area<{ t: number; low: number; high: number }>()
  .x((p) => x(p.t))
  .y0((p) => y(p.low))
  .y1((p) => y(p.high));
const median = line<{ t: number; median: number }>()
  .x((p) => x(p.t))
  .y((p) => y(p.median));

/** The edited cut's beats: the payoff moved after the intro, the tangent cut, the sponsor moved later. */
const BEATS = [
  { startS: 0, endS: 15, group: "opening", label: "Hook" },
  { startS: 15, endS: 40, group: "opening", label: "" },
  { startS: 40, endS: 80, group: "content", label: "Payoff", moved: true },
  { startS: 80, endS: 140, group: "content", label: "Explanation" },
  { startS: 140, endS: 240, group: "content", label: "Demo" },
  { startS: 240, endS: 280, group: "promotion", label: "Sponsor", moved: true },
  { startS: 280, endS: 300, group: "promotion", label: "" },
] as const;

/** Roughly how wide a 12px label is, to show only the labels that fit their beat. */
const labelWidth = (text: string) => text.length * 6.6 + 10;

const EDITS = [
  { label: "Move the payoff to 0:40", effect: "+30 s" },
  { label: "Cut the tangent at 1:40", effect: "+7.0 s" },
  { label: "Move the sponsor read to 4:20", effect: "+2.4 s" },
];

export function HeroPreview() {
  return (
    <figure className="flex flex-col gap-4 rounded-[4px] border-2 border-ink bg-surface p-4 sm:p-5">
      <figcaption className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-heading text-lg font-bold tracking-tight">
          I built a guitar in a weekend
        </span>
        <Badge variant="plain">Example</Badge>
      </figcaption>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col">
          <span className="text-sm text-ink-muted">Predicted average view with 3 edits</span>
          <span className="font-heading text-[40px] leading-none font-bold tracking-tight tabular-nums">
            2:27
          </span>
        </div>
        <span className="rounded-full border-2 border-positive px-2.5 py-0.5 text-sm font-medium tabular-nums">
          +47 s (43 s to 51 s)
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VIEW.width} ${VIEW.height}`}
        role="img"
        aria-label="Example: the share of subscribers and newcomers predicted to still be watching a 5-minute cut with 3 edits, each a range with its middle as a dashed line, over the cut's beats."
        className="h-auto w-full"
      >
        <defs>
          <clipPath id="hero-plot">
            <rect
              x={PLOT.left}
              y={PLOT.top - 2}
              width={PLOT.right - PLOT.left}
              height={PLOT.bottom - PLOT.top + 2}
            />
          </clipPath>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((share) => (
          <g key={share}>
            <line
              x1={PLOT.left}
              x2={PLOT.right}
              y1={y(share)}
              y2={y(share)}
              stroke="var(--rule)"
              strokeDasharray="4 4"
            />
            <text
              x={PLOT.left - 8}
              y={y(share) + 4}
              textAnchor="end"
              className="font-mono"
              fontSize="12"
              fill="var(--ink-muted)"
            >
              {share * 100}%
            </text>
          </g>
        ))}
        <g clipPath="url(#hero-plot)">
          {AUDIENCES.map(({ key, points }) => (
            <g key={key}>
              <path
                d={band(points) ?? ""}
                fill={AUDIENCE_COLOR[key]}
                fillOpacity="0.35"
                stroke="var(--ink)"
                strokeWidth="1"
              />
              <path
                d={median(points) ?? ""}
                fill="none"
                stroke="var(--ink)"
                strokeWidth="2"
                strokeDasharray="6 4"
              />
            </g>
          ))}
        </g>
        <path
          d={`M ${PLOT.left} ${PLOT.top} V ${PLOT.bottom} H ${PLOT.right}`}
          fill="none"
          stroke="var(--ink)"
          strokeWidth="2"
        />
        {[0, 60, 120, 180, 240, 300].map((seconds) => (
          <text
            key={seconds}
            x={x(seconds)}
            y={PLOT.bottom + 18}
            textAnchor={seconds === DURATION_S ? "end" : "middle"}
            className="font-mono"
            fontSize="12"
            fill="var(--ink-muted)"
          >
            {formatClock(seconds)}
          </text>
        ))}
        {BEATS.map((beat) => {
          const left = x(beat.startS);
          const width = x(beat.endS) - left;
          return (
            <g key={beat.startS}>
              <rect
                x={left}
                y={STRIP.top}
                width={width}
                height={STRIP.height}
                fill={BEAT_GROUP_COLOR[beat.group]}
                stroke="var(--ink)"
                strokeWidth="2"
              />
              {beat.label && width > labelWidth(beat.label) + ("moved" in beat ? 22 : 0) ? (
                <text
                  x={left + 6}
                  y={STRIP.top + STRIP.height / 2 + 4}
                  fontSize="12"
                  fill="var(--ink)"
                  className="hidden sm:inline"
                >
                  {beat.label}
                </text>
              ) : null}
              {"moved" in beat ? (
                <path
                  d={`M ${left + width - 20} ${STRIP.top + STRIP.height / 2} h 12 m -5 -5 l 5 5 l -5 5`}
                  fill="none"
                  stroke="var(--ink)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ) : null}
            </g>
          );
        })}
      </svg>

      <ul className="flex flex-col gap-2" aria-label="Edits ticked in the example">
        {EDITS.map((edit) => (
          <li
            key={edit.label}
            className="flex items-center gap-3 rounded-[4px] border-2 border-ink px-3 py-2"
          >
            <span
              aria-hidden="true"
              className="flex size-5 shrink-0 items-center justify-center rounded-[4px] border-2 border-ink bg-accent"
            >
              <Check className="size-3.5" strokeWidth={3} />
            </span>
            <span className="min-w-0 flex-1 text-sm font-medium">{edit.label}</span>
            <span className="shrink-0 rounded-full border-2 border-positive px-2 py-0.5 text-xs font-medium tabular-nums">
              {edit.effect}
            </span>
          </li>
        ))}
      </ul>
    </figure>
  );
}
