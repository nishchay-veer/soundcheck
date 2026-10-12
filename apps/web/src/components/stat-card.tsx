import { Card } from "@soundcheck/ui/components/card";
import { cn } from "@soundcheck/ui/lib/utils";
import type { ReactNode } from "react";
import { InfoTip } from "./info-tip";

/** One number with its label; `hint` explains it in a tooltip. */
export function StatCard({
  label,
  value,
  detail,
  hint,
  className,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("flex min-w-0 flex-col gap-2 p-4 sm:p-5", className)}>
      <div className="flex items-center gap-1.5 text-sm text-ink-muted">
        {label}
        {hint ? <InfoTip label={`About ${label.toLowerCase()}`}>{hint}</InfoTip> : null}
      </div>
      <div className="font-heading text-[40px] leading-none font-bold tracking-tight tabular-nums">
        {value}
      </div>
      {detail ? <div className="text-sm text-ink-muted">{detail}</div> : null}
    </Card>
  );
}
