import type { AudienceCard as AudienceCardData } from "@soundcheck/core/schemas";
import { Card } from "@soundcheck/ui/components/card";
import { cn } from "@soundcheck/ui/lib/utils";
import type { ReactNode } from "react";
import { AUDIENCE_FILL } from "@/lib/audiences";
import { formatPercent, formatShare } from "@/lib/format";
import { IntervalText } from "./interval-text";
import { KindBadge } from "./kind-badge";

/**
 * One audience: its color, whether it is measured or estimated, its share of
 * views and watch time, its average view percentage, its top traits with
 * intervals, and its description. `action` (the "see every effect" button)
 * sits at the bottom; give it `after:absolute after:inset-0` to make the whole
 * card open it.
 */
export function AudienceCard({
  card,
  action,
  className,
}: {
  card: AudienceCardData;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <Card
      interactive={Boolean(action)}
      className={cn("relative flex flex-col overflow-hidden", className)}
    >
      <div
        aria-hidden="true"
        className={cn("h-3 border-b-2 border-ink", AUDIENCE_FILL[card.key])}
      />
      <div className="flex flex-1 flex-col gap-5 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h3 className="font-heading text-[28px] leading-tight font-bold tracking-tight">
            {card.label}
          </h3>
          <div className="relative z-10">
            <KindBadge kind={card.kind} />
          </div>
        </div>
        <dl className="grid grid-cols-3 gap-3 tabular-nums">
          <div>
            <dt className="text-sm text-ink-muted">Views</dt>
            <dd className="text-xl font-medium">{formatShare(card.viewShare)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Watch time</dt>
            <dd className="text-xl font-medium">
              {card.watchTimeShare === null ? "Not reported" : formatShare(card.watchTimeShare)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Average view</dt>
            <dd className="text-xl font-medium">
              {card.avgViewPct === null ? "Not reported" : formatPercent(card.avgViewPct)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <h4 className="text-sm text-ink-muted">
            Top traits: change in viewers still watching at the end, with a 90% interval
          </h4>
          {card.traits.length ? (
            <ul className="flex flex-col gap-2">
              {card.traits.map((trait) => (
                <li key={trait.feature} className="flex flex-col">
                  <span>{trait.statement.replace(/:.*$/, "")}</span>
                  <IntervalText delta={trait.deltaPp} ci={trait.ci} className="text-sm" />
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-muted">
              No clear traits yet: every effect&apos;s interval still includes zero.
            </p>
          )}
        </div>
        <p>{card.description}</p>
        {action ? <div className="mt-auto">{action}</div> : null}
      </div>
    </Card>
  );
}
