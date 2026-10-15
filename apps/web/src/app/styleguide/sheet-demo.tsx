"use client";

import { Button } from "@soundcheck/ui/components/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from "@soundcheck/ui/components/sheet";
import { EffectList } from "@/components/effect-list";
import { SAMPLE_CARDS } from "./samples";

export function SheetDemo() {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="secondary">Open a sheet</Button>
      </SheetTrigger>
      <SheetContent>
        <SheetTitle>Newcomers: what keeps them watching</SheetTitle>
        <SheetDescription>
          Soundcheck tried small changes to a typical video of yours, and predicted how many of
          every 100 viewers would still be watching at the end. Sample data.
        </SheetDescription>
        <EffectList effects={SAMPLE_CARDS[1]?.effects ?? []} />
      </SheetContent>
    </Sheet>
  );
}
