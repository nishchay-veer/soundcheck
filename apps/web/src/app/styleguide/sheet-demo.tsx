"use client";

import { Button } from "@soundcheck/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@soundcheck/ui/components/sheet";
import { EffectBar } from "@/components/effect-bar";
import { SAMPLE_EFFECTS } from "./samples";

export function SheetDemo() {
  const domain = Math.max(...SAMPLE_EFFECTS.flatMap((e) => (e.ci ? e.ci.map(Math.abs) : [])));
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">Open a sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>Subscribers: every effect</SheetTitle>
        <SheetDescription>
          Change in viewers still watching at the end, with a 90% interval. Sample data.
        </SheetDescription>
        <div className="flex flex-col gap-5">
          {SAMPLE_EFFECTS.map((effect) => (
            <EffectBar
              key={effect.label}
              label={effect.label}
              delta={effect.delta}
              ci={effect.ci}
              domain={domain}
            />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
