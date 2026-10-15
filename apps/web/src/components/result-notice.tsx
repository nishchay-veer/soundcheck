import { Badge } from "@soundcheck/ui/components/badge";
import type { ModelStanding } from "@/lib/model-standing";

const list = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const lower = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/**
 * The note on every screen that shows model numbers while a model is not
 * usable. When none is, the numbers prove the pipeline works, not how anyone
 * watches. When some are, it names the audiences it is about and says which
 * numbers are real results. White with a yellow badge, so it never reads as
 * the yellow headline banner. Nothing when every model is usable.
 */
export function ResultNotice({ standing }: { standing: ModelStanding }) {
  const { notUsable, usable } = standing;
  if (!notUsable.length) return null;
  let badge = "Not a result yet";
  let text: string;
  if (!usable.length) {
    const why = [...new Set(notUsable.flatMap((audience) => audience.reasons))]
      .map(capital)
      .join(". ");
    text = `${why ? `${why}. ` : ""}These numbers show that Soundcheck works on your channel; they don't describe your audiences yet.`;
  } else {
    badge = `Not a result yet for ${list.format(notUsable.map((audience) => lower(audience.label)))}`;
    const why = notUsable
      .map((audience) => `${audience.label}: ${audience.reasons.join("; ") || "not usable yet"}.`)
      .join(" ");
    text = `${why} Until then, their numbers don't describe how they watch. The numbers for ${list.format(usable.map(lower))} are real results.`;
  }
  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded-[4px] border-2 border-ink bg-surface p-4 sm:p-5"
    >
      <Badge>{badge}</Badge>
      <p>{text}</p>
    </div>
  );
}
