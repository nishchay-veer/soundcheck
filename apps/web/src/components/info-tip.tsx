"use client";

import { Tooltip, TooltipContent, TooltipTrigger } from "@soundcheck/ui/components/tooltip";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { Info } from "lucide-react";
import type { ReactNode } from "react";

/** An "i" that explains something on hover or keyboard focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className={cn("inline-flex rounded-full", FOCUS_RING)}
        >
          <Info aria-hidden="true" className="size-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{children}</TooltipContent>
    </Tooltip>
  );
}
