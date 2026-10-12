import type { Drop, ModelStamp } from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@soundcheck/ui/components/popover";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { CircleHelp } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import {
  CAUSE_NOTE,
  UNEXPLAINED_NOTE,
  dropReason,
  dropTitle,
  effectLink,
  sharePercent,
} from "@/lib/drops";
import { formatClock } from "@/lib/format";

const chip =
  "inline-flex items-center gap-1.5 rounded-full border-2 border-ink px-3 py-1 text-sm font-medium";
const label = "inline-flex items-center gap-1.5 rounded-full";

/**
 * A chip's "?": what its cause means, opened by a click or tap (a tooltip
 * would not open on a phone). The button is 24 px for touch but takes no
 * more height in the chip than its text.
 */
function Note({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`What "${label}" means`}
        className={cn(
          "-my-1 -mr-1.5 inline-flex size-6 items-center justify-center rounded-full",
          FOCUS_RING,
        )}
      >
        <CircleHelp aria-hidden="true" className="size-4" />
      </PopoverTrigger>
      <PopoverContent>{children}</PopoverContent>
    </Popover>
  );
}

/**
 * Why an audience left at one drop-off: the measured loss, the caption, and
 * what the model links it to, in a sentence and as chips: each cause with
 * its share and a link to its effect, and always the unexplained rest,
 * however large: a large unexplained share is information too.
 */
export function DropPanel({ drop, model }: { drop: Drop | null; model: ModelStamp | null }) {
  if (!drop) {
    return (
      <section
        aria-labelledby="drop-title"
        className="flex flex-col gap-2 rounded-[4px] border-2 border-ink bg-surface p-5"
      >
        <h2
          id="drop-title"
          className="font-heading text-[28px] leading-tight font-bold tracking-tight"
        >
          No clear drop-offs
        </h2>
        <p className="text-ink-muted">
          Viewers left this video at a steady pace, with no stretch much faster than the rest.
        </p>
      </section>
    );
  }
  return (
    <section
      aria-labelledby="drop-title"
      className="flex flex-col gap-4 rounded-[4px] border-2 border-ink bg-surface p-5"
    >
      <div className="flex flex-col gap-1">
        <h2
          id="drop-title"
          className="font-heading text-[28px] leading-tight font-bold tracking-tight"
        >
          {dropTitle(drop)}
        </h2>
        <p className="font-mono text-sm text-ink-muted">
          {formatClock(drop.startS)} to {formatClock(drop.endS)}
        </p>
      </div>
      <p className="text-lg">{drop.narrative}</p>
      <div className="flex flex-col gap-2">
        <h3 className="text-sm text-ink-muted">What the model links it to</h3>
        <p>{dropReason(drop)}</p>
        {model && !model.usable ? (
          <p className="text-sm">
            <Badge className="mr-2">Not a result yet</Badge>
            {model.unusableReasons.join("; ")}.
          </p>
        ) : null}
        <ul className="flex flex-wrap gap-2">
          {drop.attributions.map((attribution) => {
            const href = effectLink(drop, attribution.group);
            // The spaces keep "Sponsor segment 55% (see …)" apart in the accessible
            // name; the flex layout ignores them.
            const content = (
              <>
                {attribution.label}{" "}
                <span className="tabular-nums">{sharePercent(attribution.share)}</span>
              </>
            );
            return (
              <li key={attribution.group} className={cn(chip, "bg-surface")}>
                {href ? (
                  // Its name starts with what it shows, for voice control.
                  <Link
                    href={href}
                    className={cn(label, "underline-offset-4 hover:underline", FOCUS_RING)}
                  >
                    {content}{" "}
                    <span className="sr-only">(see this effect on the audiences screen)</span>
                  </Link>
                ) : (
                  <span className={label}>{content}</span>
                )}
                <Note label={attribution.label}>{CAUSE_NOTE[attribution.group]}</Note>
              </li>
            );
          })}
          <li className={cn(chip, "border-dashed bg-bg")}>
            <span className={label}>
              Unexplained
              <span className="tabular-nums">{sharePercent(drop.residualShare)}</span>
            </span>
            <Note label="Unexplained">{UNEXPLAINED_NOTE}</Note>
          </li>
        </ul>
      </div>
    </section>
  );
}
