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
import { useState } from "react";
import { AudienceCard } from "./audience-card";
import { EffectList } from "./effect-list";

/**
 * One audience's sheet: what Soundcheck tried on a typical video, in plain
 * words, grouped by what it found. `highlight` marks the effect a link from a
 * drop-off asked for.
 */
function EffectsSheet({
  card,
  open,
  onOpenChange,
  highlight,
}: {
  card: AudienceCardData;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  highlight: string | null;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          // Stretched over the card, so a click anywhere on it opens the sheet.
          className={cn(
            "font-medium underline underline-offset-4 after:absolute after:inset-0",
            FOCUS_RING,
          )}
        >
          See what keeps them watching
        </button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>{card.label}: what keeps them watching</SheetTitle>
        <SheetDescription>
          Soundcheck tried small changes to a typical video of yours, and predicted how many of
          every 100 viewers would still be watching at the end.
        </SheetDescription>
        {card.model && !card.model.usable ? (
          <p className="rounded-[4px] border-2 border-ink bg-highlight px-3 py-2 text-sm">
            Not a result yet: {card.model.unusableReasons.join("; ")}.
          </p>
        ) : null}
        <EffectList effects={card.effects} highlight={highlight} />
      </SheetContent>
    </Sheet>
  );
}

/**
 * The audience cards, revealed once in turn (the audiences screen's one
 * reveal; none under reduced motion). A card with effects opens its sheet.
 */
export function AudienceGrid({
  cards,
  focus = null,
}: {
  cards: readonly AudienceCardData[];
  /** Opens this audience's sheet at this effect (a link from a video's drop-off). */
  focus?: { audience: string; effect: string } | null;
}) {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState<string | null>(
    focus && cards.some((card) => card.key === focus.audience && card.effects.length)
      ? focus.audience
      : null,
  );
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
            action={
              card.effects.length ? (
                <EffectsSheet
                  card={card}
                  open={open === card.key}
                  onOpenChange={(next) => setOpen(next ? card.key : null)}
                  highlight={focus?.audience === card.key ? focus.effect : null}
                />
              ) : undefined
            }
          />
        </motion.li>
      ))}
    </ul>
  );
}
