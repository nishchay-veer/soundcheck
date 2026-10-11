import { Card } from "@soundcheck/ui/components/card";
import type { ReactNode } from "react";
import { InfoTip } from "./info-tip";

/** One number with its label; `hint` explains it in a tooltip. */
export function StatCard({
  label,
  value,
  detail,
  hint,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  hint?: ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-2 p-5">
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
