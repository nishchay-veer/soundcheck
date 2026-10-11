import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

/** A cream block with a black border where content will load; no shimmer. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      aria-hidden="true"
      className={cn("rounded-[4px] border-2 border-ink bg-bg", className)}
      {...props}
    />
  );
}
