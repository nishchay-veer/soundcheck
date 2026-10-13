import type { SoundcheckDoc } from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { FOCUS_RING, LIFT } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import Link from "next/link";
import { formatClock } from "@/lib/format";
import { KIND_LABELS, STATUS_LABELS, soundcheckTitle } from "@/lib/soundcheck";

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** A channel's soundchecks, newest first; each opens its page. */
export function SoundcheckList({ soundchecks }: { soundchecks: readonly SoundcheckDoc[] }) {
  return (
    <ul className="flex flex-col gap-3">
      {soundchecks.map((doc) => (
        <li key={doc.soundcheckId}>
          <Link
            href={`/app/soundcheck/${doc.soundcheckId}`}
            className={cn(
              "flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[4px] border-2 border-ink bg-surface p-4",
              LIFT,
              FOCUS_RING,
            )}
          >
            <span className="min-w-0 flex-1 basis-60 font-heading text-lg font-bold break-words">
              {soundcheckTitle(doc)}
            </span>
            <span className="text-sm text-ink-muted">{KIND_LABELS[doc.input.kind]}</span>
            <span className="text-sm text-ink-muted">{date.format(new Date(doc.createdAt))}</span>
            {doc.status === "ready" && doc.prediction ? (
              <span className="tabular-nums">
                Predicted average view {formatClock(doc.prediction.avdS.p50)}
              </span>
            ) : (
              <Badge variant={doc.status === "failed" ? "plain" : "highlight"}>
                {STATUS_LABELS[doc.status]}
              </Badge>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}
