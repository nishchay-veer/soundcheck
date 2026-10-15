"use client";

import type { Effect } from "@soundcheck/core/schemas";
import { cn } from "@soundcheck/ui/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { effectSentence, effectText, groupEffects } from "@/lib/effects";

/**
 * An audience's effects in plain words, grouped by what they say: what keeps
 * viewers watching, what makes them leave (each with how many of every 100
 * stay, and a range), what can't be told yet, and what the channel's videos
 * never had. `highlight` marks the effect a link from a drop-off asked for.
 */
export function EffectList({
  effects,
  highlight = null,
}: {
  effects: readonly Effect[];
  highlight?: string | null;
}) {
  const groups = groupEffects(effects);
  const clear = groups.keeps.length + groups.loses.length > 0;
  return (
    <div className="flex flex-col gap-8">
      {clear ? null : (
        <p className="rounded-[4px] border-2 border-ink bg-surface p-4">
          <strong>Nothing clear yet.</strong> As Soundcheck learns from more of your videos, the
          changes that keep these viewers watching, or make them leave, will show up here.
        </p>
      )}
      <ClearGroup title="Keeps them watching" effects={groups.keeps} highlight={highlight} />
      <ClearGroup title="Makes them leave" effects={groups.loses} highlight={highlight} />
      {groups.unclear.length ? (
        <Group
          title={`No clear effect yet (${groups.unclear.length})`}
          note="Soundcheck can't tell yet whether these help or hurt."
        >
          <ul className="divide-y-2 divide-ink overflow-hidden rounded-[4px] border-2 border-ink bg-surface">
            {groups.unclear.map((effect) => {
              const { name, tried } = effectText(effect);
              const highlighted = effect.feature === highlight;
              return (
                <li
                  key={effect.feature}
                  ref={highlighted ? scrollIntoView : undefined}
                  aria-current={highlighted ? "true" : undefined}
                  className={cn("flex flex-col px-3 py-2.5", highlighted && "bg-highlight")}
                >
                  <span className="font-medium">{name}</span>
                  {tried ? <span className="text-sm text-ink-muted">{tried}</span> : null}
                </li>
              );
            })}
          </ul>
        </Group>
      ) : null}
      {groups.absent.length ? (
        <Group
          title={`Not in your videos yet (${groups.absent.length})`}
          note="None of your videos has these yet, so there's nothing to learn from."
        >
          <ul className="flex flex-wrap gap-2">
            {groups.absent.map((effect) => (
              <li
                key={effect.feature}
                aria-current={effect.feature === highlight ? "true" : undefined}
                ref={effect.feature === highlight ? scrollIntoView : undefined}
                className={cn(
                  "rounded-full border-2 border-ink px-3 py-1 text-sm",
                  effect.feature === highlight ? "bg-highlight" : "bg-surface",
                )}
              >
                {effectText(effect).name}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
    </div>
  );
}

/** Brings a linked effect into view once its sheet has opened. */
function scrollIntoView(element: HTMLElement | null) {
  element?.scrollIntoView({ block: "center" });
}

function Group({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-heading text-xl font-bold tracking-tight">{title}</h3>
        {note ? <p className="text-sm text-ink-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Item({ highlighted, children }: { highlighted: boolean; children: ReactNode }) {
  return (
    <li
      ref={highlighted ? scrollIntoView : undefined}
      aria-current={highlighted ? "true" : undefined}
      className={cn(
        "flex flex-col gap-1 rounded-[4px] border-2 border-ink p-3",
        highlighted ? "bg-highlight" : "bg-surface",
      )}
    >
      {children}
    </li>
  );
}

/** Effects whose whole range is on one side: each with its verdict, what was tried, and how many of 100 stay. */
function ClearGroup({
  title,
  effects,
  highlight,
}: {
  title: string;
  effects: readonly Effect[];
  highlight: string | null;
}) {
  if (!effects.length) return null;
  return (
    <Group title={title}>
      <ul className="flex flex-col gap-3">
        {effects.map((effect) => {
          const { name, tried } = effectText(effect);
          const keeps = (effect.deltaPp ?? 0) > 0;
          const Arrow = keeps ? ArrowUpRight : ArrowDownRight;
          return (
            <Item key={effect.feature} highlighted={effect.feature === highlight}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 font-heading text-lg font-bold tracking-tight">
                  <Arrow
                    aria-hidden="true"
                    strokeWidth={2.5}
                    className={cn("size-5 shrink-0", keeps ? "text-positive" : "text-negative")}
                  />
                  {name}
                </span>
                <span
                  className={cn(
                    "rounded-full border-2 px-2.5 py-0.5 text-sm font-medium",
                    keeps ? "border-positive" : "border-negative",
                  )}
                >
                  {keeps ? "Keeps viewers" : "Loses viewers"}
                </span>
              </div>
              {tried ? <span className="text-sm text-ink-muted">{tried}</span> : null}
              <span>{effectSentence(effect)}</span>
            </Item>
          );
        })}
      </ul>
    </Group>
  );
}
