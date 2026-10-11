/**
 * The banner on every screen that shows model numbers while the models are
 * not usable: they prove the pipeline works, not how the audience watches.
 */
export function ResultNotice({ reasons }: { reasons: readonly string[] }) {
  const why = reasons.map((reason) => reason.charAt(0).toUpperCase() + reason.slice(1)).join(". ");
  return (
    <div
      role="note"
      className="flex flex-col gap-1 rounded-[4px] border-2 border-ink bg-highlight p-4 sm:p-5"
    >
      <p className="font-heading text-xl font-bold">Not a result yet</p>
      <p>
        {why ? `${why}. ` : ""}These numbers show that Soundcheck works on your channel; they
        don&apos;t describe your audiences yet.
      </p>
    </div>
  );
}
