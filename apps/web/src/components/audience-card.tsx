import type { AudienceCard as AudienceCardData } from "@soundcheck/core/schemas";
import { Card } from "@soundcheck/ui/components/card";
import { cn } from "@soundcheck/ui/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import { AUDIENCE_FILL } from "@/lib/audiences";
import { effectText, traitLine } from "@/lib/effects";
import { formatPercent, formatShare } from "@/lib/format";
import { KindBadge } from "./kind-badge";

/**
 * One audience: its color, whether it is measured or estimated, its share of
 * views and watch time, its average view percentage, what makes a clear
 * difference to it in plain words, and its description. `action` (the "see
 * what keeps them watching" button)
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
            <dt className="text-sm text-ink-muted">Share of views</dt>
            <dd className="text-xl font-medium">{formatShare(card.viewShare)}</dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Share of watch time</dt>
            <dd className="text-xl font-medium">
              {card.watchTimeShare === null ? "Not reported" : formatShare(card.watchTimeShare)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Average % viewed</dt>
            <dd className="text-xl font-medium">
              {card.avgViewPct === null ? "Not reported" : formatPercent(card.avgViewPct)}
            </dd>
          </div>
        </dl>
        <div className="flex flex-col gap-2">
          <h4 className="font-heading text-lg font-bold tracking-tight">What makes a difference</h4>
          {card.traits.length ? (
            <ul className="flex flex-col gap-2">
              {card.traits.map((trait) => {
                const keeps = trait.deltaPp > 0;
                const Arrow = keeps ? ArrowUpRight : ArrowDownRight;
                return (
                  <li key={trait.feature} className="flex items-start gap-2">
                    <Arrow
                      aria-hidden="true"
                      strokeWidth={2.5}
                      className={cn(
                        "mt-0.5 size-5 shrink-0",
                        keeps ? "text-positive" : "text-negative",
                      )}
                    />
                    <span>
                      <span className="font-medium">
                        {
                          effectText({
                            feature: trait.feature,
                            label: trait.statement.replace(/:.*$/, ""),
                          }).name
                        }
                      </span>
                      : {traitLine(trait)}
                    </span>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-ink-muted">
              Nothing clear yet. With more videos, Soundcheck will learn what keeps them watching.
            </p>
          )}
        </div>
        <p>{card.description}</p>
        {action ? <div className="mt-auto">{action}</div> : null}
      </div>
    </Card>
  );
}
