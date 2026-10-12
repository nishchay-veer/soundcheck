import { Badge } from "@soundcheck/ui/components/badge";

/**
 * The note on every screen that shows model numbers while the models are not
 * usable: they prove the pipeline works, not how the audience watches. White
 * with a yellow badge, so it never reads as the yellow headline banner.
 */
export function ResultNotice({ reasons }: { reasons: readonly string[] }) {
  const why = reasons.map((reason) => reason.charAt(0).toUpperCase() + reason.slice(1)).join(". ");
  return (
    <div
      role="note"
      className="flex flex-col gap-2 rounded-[4px] border-2 border-ink bg-surface p-4 sm:p-5"
    >
      <Badge>Not a result yet</Badge>
      <p>
        {why ? `${why}. ` : ""}These numbers show that Soundcheck works on your channel; they
        don&apos;t describe your audiences yet.
      </p>
    </div>
  );
}
