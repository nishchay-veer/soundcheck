import type { HTMLAttributes } from "react";
import { LIFT } from "../lib/styles";
import { cn } from "../lib/utils";

/**
 * A white card with a 2px black border and a 4px radius. Static cards have no
 * shadow; `interactive` adds the hover lift for cards that are clickable.
 */
export function Card({
  className,
  interactive = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { interactive?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-[4px] border-2 border-ink bg-surface text-ink",
        interactive && LIFT,
        className,
      )}
      {...props}
    />
  );
}
