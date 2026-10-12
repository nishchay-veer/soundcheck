"use client";

import type { VideoBeat } from "@soundcheck/core/schemas";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { useMemo, useState, type KeyboardEvent } from "react";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import { BEAT_GROUPS, BEAT_GROUP_COLOR, beatGroup, type BeatGroup } from "@/lib/beats";
import { CHART, chartScales } from "@/lib/chart";
import { formatClock } from "@/lib/format";
import { useResizeObserver } from "@/lib/use-resize-observer";
import { BeatStrip } from "./beat-strip";
import { RetentionChart, type ChartDrop, type ChartSeries } from "./retention-chart";

type Shown = "subscribed" | "unsubscribed" | "both";

const chip = "rounded-full border-2 border-ink px-3 py-1 text-sm font-medium";

/**
 * The autopsy chart: each audience's retention above the beat strip, on one
 * time scale, scrolling sideways together below 640 px. Chips pick the
 * audience, a toggle hides the model, clicking seeks, and the left and right
 * arrow keys step between drop-offs (selecting one also seeks to it, in the
 * parent).
 */
export function AutopsyChart({
  id,
  title,
  durationS,
  series,
  beats,
  drops,
  selectedDropId,
  onSelectDrop,
  onSeek,
  playheadS,
}: {
  id: string;
  title: string;
  durationS: number;
  series: readonly ChartSeries[];
  beats: readonly VideoBeat[];
  drops: readonly ChartDrop[];
  selectedDropId: string | null;
  onSelectDrop: (id: string) => void;
  onSeek: (seconds: number) => void;
  playheadS?: number | null;
}) {
  const [ref, measured] = useResizeObserver<HTMLDivElement>(CHART.minWidth);
  const scales = useMemo(() => chartScales(measured, durationS), [measured, durationS]);
  const [shown, setShown] = useState<Shown>("both");
  const [showModel, setShowModel] = useState(true);
  const [hovered, setHovered] = useState<string | null>(null);

  const keys = series.map((s) => s.key);
  const visible = series.filter((s) => shown === "both" || s.key === shown);
  const visibleDrops = drops
    .filter((drop) => shown === "both" || drop.audience === shown)
    .toSorted((a, b) => a.startS - b.startS || a.audience.localeCompare(b.audience));
  const selected = visibleDrops.find((drop) => drop.id === selectedDropId) ?? null;
  const hasModel = series.some((s) => s.band);

  function step(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    if (!visibleDrops.length) return;
    event.preventDefault();
    const at = selected ? visibleDrops.indexOf(selected) : -1;
    const next =
      event.key === "ArrowRight"
        ? Math.min(visibleDrops.length - 1, at + 1)
        : Math.max(0, at === -1 ? 0 : at - 1);
    const drop = visibleDrops[next];
    if (drop) onSelectDrop(drop.id);
  }

  const summary = visible
    .filter((s) => s.actual)
    .map(
      (s) => `${s.label}: ${Math.round((s.actual?.at(-1) ?? 0) * 100)}% still watching at the end`,
    )
    .join("; ");
  const options: { value: Shown; label: string }[] = [
    ...(keys.includes("subscribed")
      ? [{ value: "subscribed" as const, label: "Subscribers" }]
      : []),
    ...(keys.includes("unsubscribed")
      ? [{ value: "unsubscribed" as const, label: "Newcomers" }]
      : []),
    ...(keys.length > 1 ? [{ value: "both" as const, label: "Both" }] : []),
  ];
  // The legend lists the beat groups this video has, in the design system's order.
  const present = new Set(beats.map((beat) => beatGroup(beat.beatType)));
  const groups = (Object.keys(BEAT_GROUPS) as BeatGroup[]).filter((group) => present.has(group));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        {options.length > 1 ? (
          <div role="radiogroup" aria-label="Audience" className="flex flex-wrap gap-2">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={shown === option.value}
                onClick={() => setShown(option.value)}
                className={cn(
                  chip,
                  FOCUS_RING,
                  shown === option.value ? "bg-accent" : "bg-surface",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
        {hasModel ? (
          <button
            type="button"
            aria-pressed={showModel}
            onClick={() => setShowModel((on) => !on)}
            className={cn(chip, FOCUS_RING, showModel ? "bg-accent" : "bg-surface")}
          >
            Show model
          </button>
        ) : null}
      </div>

      <div
        ref={ref}
        tabIndex={0}
        role="group"
        aria-label={`${title}. Left and right arrow keys move between drop-offs.`}
        onKeyDown={step}
        className={cn("overflow-x-auto rounded-[4px] border-2 border-ink bg-surface", FOCUS_RING)}
      >
        <div style={{ width: scales.width }}>
          <RetentionChart
            id={id}
            label={`${title}. ${summary}.`}
            scales={scales}
            durationS={durationS}
            series={visible}
            showModel={showModel}
            drops={visibleDrops}
            selectedDropId={selected?.id ?? null}
            hoveredDropId={hovered}
            onHoverDrop={setHovered}
            onSelectDrop={onSelectDrop}
            onSeek={onSeek}
            playheadS={playheadS}
          />
          {beats.length ? (
            <BeatStrip scales={scales} durationS={durationS} beats={beats} onSeek={onSeek} />
          ) : null}
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {visible.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="h-1.5 w-6 rounded-full border border-ink"
              style={{ background: AUDIENCE_COLOR[s.key] }}
            />
            {s.label}
          </li>
        ))}
        {hasModel && showModel ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="w-6 border-t-2 border-dashed border-ink" />
            Predicted median, in a 10th to 90th percentile band
          </li>
        ) : null}
        {visibleDrops.length ? (
          <li className="flex items-center gap-2">
            <span aria-hidden="true" className="h-3 w-6 border border-ink bg-negative/15" />
            Drop-off
          </li>
        ) : null}
        {groups.map((group) => (
          <li key={group} className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className={cn("h-3 w-6 border border-ink", group === "tangent" && "border-dashed")}
              style={{ background: BEAT_GROUP_COLOR[group] }}
            />
            {BEAT_GROUPS[group].label}
          </li>
        ))}
      </ul>

      <p className="sr-only" aria-live="polite">
        {selected
          ? `Drop-off from ${formatClock(selected.startS)} to ${formatClock(selected.endS)} selected.`
          : ""}
      </p>
    </div>
  );
}
