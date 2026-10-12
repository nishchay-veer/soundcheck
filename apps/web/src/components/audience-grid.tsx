"use client";

import type { AudienceCard as AudienceCardData } from "@soundcheck/core/schemas";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@soundcheck/ui/components/sheet";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { motion, useReducedMotion } from "motion/react";
import { effectDomain } from "@/lib/audiences-view";
import { AudienceCard } from "./audience-card";
import { EffectBar } from "./effect-bar";

/** One audience's sheet: every simulated effect on one scale, centered on zero. */
function EffectsSheet({ card }: { card: AudienceCardData }) {
  const domain = effectDomain(card.effects);
  return (
    <Sheet>
      <SheetTrigger asChild>
        <button
          type="button"
          // Stretched over the card, so a click anywhere on it opens the sheet.
          className={cn(
            "font-medium underline underline-offset-4 after:absolute after:inset-0",
            FOCUS_RING,
          )}
        >
          See every effect ({card.effects.length})
        </button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>{card.label}: every effect</SheetTitle>
        <SheetDescription>
          How many more or fewer viewers would still be watching at the end of a typical video of
          yours with each edit, in percentage points, with a 90% interval.
        </SheetDescription>
        {card.model && !card.model.usable ? (
          <p className="rounded-[4px] border-2 border-ink bg-highlight px-3 py-2 text-sm">
            Not a result yet: {card.model.unusableReasons.join("; ")}.
          </p>
        ) : null}
        <p className="text-sm text-ink-muted">
          Green or red: a clear effect. White: can&apos;t tell yet, because the interval includes
          zero. Not learned: it never varied in your videos.
        </p>
        <div className="flex flex-col gap-5">
          {card.effects.map((effect) => (
            <EffectBar
              key={effect.feature}
              label={effect.label}
              delta={effect.deltaPp}
              ci={effect.ci}
              domain={domain}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/**
 * The audience cards, revealed once in turn (the audiences screen's one
 * reveal; none under reduced motion). A card with effects opens its sheet.
 */
export function AudienceGrid({ cards }: { cards: readonly AudienceCardData[] }) {
  const reduce = useReducedMotion();
  return (
    <ul className="grid gap-6 lg:grid-cols-2">
      {cards.map((card, index) => (
        <motion.li
          key={card.key}
          className="flex"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={
            reduce ? { duration: 0 } : { duration: 0.35, delay: index * 0.08, ease: "easeOut" }
          }
        >
          <AudienceCard
            card={card}
            className="w-full"
            action={card.effects.length ? <EffectsSheet card={card} /> : undefined}
          />
        </motion.li>
      ))}
    </ul>
  );
}
