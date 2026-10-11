import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { FOCUS_RING, LIFT } from "../lib/styles";
import { cn } from "../lib/utils";

/**
 * Buttons from docs/plan/design-system.md: 2px black border, 4px radius, hard
 * offset shadow on hover while lifting up-left 4px, flat on press, a black and
 * pink focus ring, and no motion under prefers-reduced-motion.
 */
export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-[4px] border-2 border-ink px-5 py-2.5",
    "font-medium text-ink",
    LIFT,
    FOCUS_RING,
    "disabled:pointer-events-none disabled:opacity-60",
  ],
  {
    variants: {
      variant: {
        primary: "bg-accent",
        secondary: "bg-surface",
        ghost:
          "border-transparent bg-transparent px-0 underline underline-offset-4 hover:translate-x-0 hover:translate-y-0 hover:shadow-none",
      },
    },
    defaultVariants: { variant: "primary" },
  },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, variant, type = "button", ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant }), className)} {...props} />;
}
