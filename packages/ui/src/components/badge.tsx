import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/utils";

/** Pills with a 2px black border: yellow by default, white for quieter labels. */
export const badgeVariants = cva(
  "inline-flex w-fit items-center gap-1 rounded-full border-2 border-ink px-2.5 py-0.5 text-sm font-medium text-ink",
  {
    variants: {
      variant: {
        highlight: "bg-highlight",
        plain: "bg-surface",
      },
    },
    defaultVariants: { variant: "highlight" },
  },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
