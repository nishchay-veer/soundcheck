"use client";

import type { Edit, Percentiles } from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import {
  deltaOf,
  formatDelta,
  isSure,
  rankEdits,
  type Objective,
  type Recommending,
} from "@/lib/edits";
import { formatClock } from "@/lib/format";

const chip = "rounded-full border-2 border-ink px-3 py-1 text-sm font-medium";

const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const lowered = (labels: readonly string[]) =>
  list.format(labels.map((label) => label.charAt(0).toLowerCase() + label.slice(1)));

const OBJECTIVES: { value: Objective; label: string }[] = [
  { value: "avd", label: "Seconds watched" },
  { value: "avp", label: "% of the cut" },
];

/** An effect, green when its whole interval is above zero, grey when it may be nothing. */
function Effect({ delta, objective }: { delta: Percentiles; objective: Objective }) {
  const sure = isSure(delta);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border-2 px-2.5 py-0.5 text-sm font-medium tabular-nums",
        sure ? "border-positive" : "border-ink-muted text-ink-muted",
      )}
    >
      {formatDelta(delta, objective)}
      <span className="sr-only">{sure ? "(sure)" : "(uncertain)"}</span>
      {sure ? null : <span aria-hidden="true">· uncertain</span>}
    </span>
  );
}

/**
 * The suggested edits, ranked by the chosen objective, each with its beat's
 * time, its reason and its own effect; ticking edits simulates them together.
 * Two edits on one beat cannot go together, so ticking one disables the
 * others. Edits are recommended on the audiences whose model is usable when
 * they bring enough of the views (`recommending`); otherwise nothing is.
 */
export function EditPanel({
  edits,
  objective,
  onObjective,
  ticked,
  onToggle,
  recommending,
  together,
  pending,
  error,
}: {
  edits: readonly Edit[];
  objective: Objective;
  onObjective: (objective: Objective) => void;
  ticked: ReadonlySet<string>;
  onToggle: (editId: string) => void;
  recommending: Recommending;
  /** The ticked edits' effect together, from the simulation; null with none ticked. */
  together: { avdS: Percentiles; avpPp: Percentiles } | null;
  pending: boolean;
  error: string | null;
}) {
  const busyBeats = new Map(
    edits.filter((edit) => ticked.has(edit.editId)).map((edit) => [edit.edit.beat, edit.editId]),
  );
  return (
    <section aria-labelledby="edits-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="edits-title" className="font-heading text-[28px] font-bold tracking-tight">
          Suggested edits
        </h2>
        <div role="radiogroup" aria-label="Judge edits by" className="flex flex-wrap gap-2">
          {OBJECTIVES.map((option) => (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={objective === option.value}
              onClick={() => onObjective(option.value)}
              className={cn(
                chip,
                FOCUS_RING,
                objective === option.value ? "bg-accent" : "bg-surface",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {recommending.kind === "none" ? (
        <p className="text-sm">
          <Badge className="mr-2">Not a result yet</Badge>
          {recommending.why === "too-few-views"
            ? "Nothing is recommended yet: the audiences whose model is usable bring too few of the views. You can still try any edit."
            : "Nothing is recommended until your model is usable, but you can try any edit."}
        </p>
      ) : recommending.kind === "some" ? (
        <p className="text-sm">
          <span className="font-medium">Judged on {lowered(recommending.on)}:</span> the{" "}
          {lowered(recommending.without)}&apos; model isn&apos;t usable yet, so their numbers are
          left out.
        </p>
      ) : null}

      {edits.length === 0 ? (
        <p className="text-ink-muted">
          No edit is predicted to keep viewers longer. Soundcheck tries cutting, trimming and moving
          each beat; none of them helped this cut.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {rankEdits(edits, objective).map((edit) => {
            const holder = busyBeats.get(edit.edit.beat);
            const blocked = holder !== undefined && holder !== edit.editId;
            const id = `edit-${edit.editId}`;
            return (
              <li
                key={edit.editId}
                className={cn(
                  "flex gap-3 rounded-[4px] border-2 bg-surface p-3",
                  ticked.has(edit.editId) ? "border-ink" : "border-ink/30",
                  blocked && "opacity-60",
                )}
              >
                <input
                  id={id}
                  type="checkbox"
                  checked={ticked.has(edit.editId)}
                  disabled={blocked}
                  onChange={() => onToggle(edit.editId)}
                  aria-describedby={`${id}-why`}
                  className={cn("mt-1 size-5 shrink-0 accent-[var(--accent)]", FOCUS_RING)}
                />
                <div className="flex min-w-0 flex-col gap-1.5">
                  <label htmlFor={id} className="flex flex-wrap items-center gap-2 font-medium">
                    {edit.label}
                    {edit.recommended ? (
                      <Badge>
                        {recommending.kind === "some"
                          ? `Recommended for ${lowered(recommending.on)}`
                          : "Recommended"}
                      </Badge>
                    ) : null}
                  </label>
                  <p id={`${id}-why`} className="text-sm text-ink-muted">
                    <span className="font-mono">{formatClock(edit.startS)}</span> · {edit.rationale}
                    {blocked ? " Another ticked edit already changes this beat." : ""}
                  </p>
                  <div>
                    <Effect delta={deltaOf(edit, objective)} objective={objective} />
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p aria-live="polite" className="min-h-6 font-medium">
        {error ? (
          error
        ) : ticked.size === 0 ? (
          "Tick edits to see the cut with them."
        ) : pending || !together ? (
          "Simulating…"
        ) : (
          <>
            With {ticked.size} edit{ticked.size === 1 ? "" : "s"}
            {recommending.kind === "some" ? `, for ${lowered(recommending.on)}` : ""}:{" "}
            <Effect
              delta={objective === "avd" ? together.avdS : together.avpPp}
              objective={objective}
            />
          </>
        )}
      </p>
    </section>
  );
}
