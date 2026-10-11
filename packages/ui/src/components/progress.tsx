"use client";

import { Progress as ProgressPrimitive } from "radix-ui";
import type { ComponentProps } from "react";
import { cn } from "../lib/utils";

/**
 * A black-bordered bar with a pink fill. `value` is 0 to 100; null means the
 * amount is unknown, and the bar stays empty.
 */
export function Progress({
  className,
  value,
  ...props
}: ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      value={value}
      className={cn(
        "relative h-4 w-full overflow-hidden rounded-[4px] border-2 border-ink bg-surface",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-accent transition-transform duration-300 motion-reduce:transition-none"
        style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, value ?? 0))}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}
