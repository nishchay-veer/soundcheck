"use client";

import type { Chapter, Edit, SimulatedSpan, VideoBeat } from "@soundcheck/core/schemas";
import { Button } from "@soundcheck/ui/components/button";
import { useState } from "react";
import { chaptersText, cutList } from "@/lib/edits";

/** A file name from the soundcheck's title: letters, digits and dashes. */
const fileName = (title: string) =>
  `${
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "soundcheck"
  }-cut-list.csv`;

/**
 * What to take to the editor and to YouTube: the ticked edits as a CSV cut
 * list in the cut's own times, and chapters for the edited cut's description.
 */
export function CutExports({
  title,
  edits,
  beats,
  durationS,
  chapters,
  spans,
  editedDurationS,
}: {
  title: string;
  /** The ticked edits. */
  edits: readonly Edit[];
  beats: readonly VideoBeat[];
  durationS: number;
  chapters: readonly Chapter[] | null;
  /** The edited cut's beats; null for the cut as it is. */
  spans: readonly SimulatedSpan[] | null;
  editedDurationS: number;
}) {
  const [copied, setCopied] = useState<string | null>(null);
  const csv = edits.length ? cutList(edits, beats, durationS) : null;
  // Until the ticked edits are simulated (or when that failed), the chapters are the cut's as it is.
  const edited = edits.length && spans ? spans : null;
  const described = chapters?.length
    ? chaptersText(chapters, beats, edited, edited ? editedDurationS : durationS)
    : null;

  async function copy(what: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setCopied(null);
    }
  }

  function download(text: string) {
    const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(title);
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section aria-labelledby="exports-title" className="flex flex-col gap-4">
      <h2 id="exports-title" className="font-heading text-[28px] font-bold tracking-tight">
        Take it to your editor
      </h2>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        <div className="flex flex-col gap-3 rounded-[4px] border-2 border-ink bg-surface p-4">
          <h3 className="font-heading text-xl font-bold">Cut list</h3>
          {csv ? (
            <>
              <p className="text-sm text-ink-muted">
                {edits.length} edit{edits.length === 1 ? "" : "s"}, in your cut&apos;s own times.
              </p>
              <pre className="overflow-x-auto rounded-[4px] border-2 border-ink bg-bg p-3 text-xs">
                {csv}
              </pre>
              <div className="flex flex-wrap gap-3">
                <Button variant="secondary" onClick={() => download(csv)}>
                  Download CSV
                </Button>
                <Button variant="secondary" onClick={() => copy("cut list", csv)}>
                  Copy
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">Tick edits to build a cut list.</p>
          )}
        </div>
        <div className="flex flex-col gap-3 rounded-[4px] border-2 border-ink bg-surface p-4">
          <h3 className="font-heading text-xl font-bold">Chapters for YouTube</h3>
          {!described ? (
            <p className="text-sm text-ink-muted">No chapters for this soundcheck.</p>
          ) : "problem" in described ? (
            <p className="text-sm">{described.problem}</p>
          ) : (
            <>
              <p className="text-sm text-ink-muted">
                {edited ? "For the cut with the ticked edits." : "For the cut as it is."} Paste them
                into the video&apos;s description.
              </p>
              <pre className="overflow-x-auto rounded-[4px] border-2 border-ink bg-bg p-3 text-sm">
                {described.text}
              </pre>
              <div>
                <Button variant="secondary" onClick={() => copy("chapters", described.text)}>
                  Copy
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
      <p aria-live="polite" className="min-h-6 text-sm">
        {copied ? `Copied the ${copied}.` : ""}
      </p>
    </section>
  );
}
