"use client";

import { Badge, badgeVariants } from "@soundcheck/ui/components/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@soundcheck/ui/components/tooltip";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import { Info } from "lucide-react";

/**
 * Whether YouTube measured an audience's curve or Soundcheck estimated it.
 * An estimate always explains itself.
 */
export function KindBadge({ kind }: { kind: "measured" | "estimated" }) {
  if (kind === "measured") return <Badge variant="plain">Measured</Badge>;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" className={cn(badgeVariants(), FOCUS_RING)}>
          Estimated
          <Info aria-hidden="true" className="size-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        YouTube has no curve for this group. It is estimated from your newcomers&apos; curves and
        how much of each video&apos;s newcomer traffic came from this source, and shown only when
        that share varies enough across your videos to tell.
      </TooltipContent>
    </Tooltip>
  );
}
