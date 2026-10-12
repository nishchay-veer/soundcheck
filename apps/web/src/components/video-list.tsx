"use client";

import type { VideoListItem } from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { FOCUS_RING } from "@soundcheck/ui/lib/styles";
import { cn } from "@soundcheck/ui/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatClock, formatPercent } from "@/lib/format";

const SORTS = {
  newest: {
    label: "Newest first",
    by: (a: VideoListItem, b: VideoListItem) => b.publishedAt.localeCompare(a.publishedAt),
  },
  oldest: {
    label: "Oldest first",
    by: (a: VideoListItem, b: VideoListItem) => a.publishedAt.localeCompare(b.publishedAt),
  },
  watched: {
    label: "Most watched through",
    by: (a: VideoListItem, b: VideoListItem) => (b.avgViewPct ?? -1) - (a.avgViewPct ?? -1),
  },
  drop: {
    label: "Biggest drop-off",
    by: (a: VideoListItem, b: VideoListItem) =>
      (b.biggestDrop?.lossPp ?? -1) - (a.biggestDrop?.lossPp ?? -1),
  },
  longest: {
    label: "Longest",
    by: (a: VideoListItem, b: VideoListItem) => b.durationS - a.durationS,
  },
} as const;
type Sort = keyof typeof SORTS;

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const AUDIENCE = { subscribed: "subscribers", unsubscribed: "newcomers" } as const;

/** The flag on a video: where its audience left fastest. */
function DropChip({ drop }: { drop: VideoListItem["biggestDrop"] }) {
  if (!drop) return <span className="text-sm text-ink-muted">No clear drop-off</span>;
  return (
    <Badge variant="plain" className="whitespace-nowrap">
      Biggest drop at <span className="font-mono">{formatClock(drop.atS)}</span>
      <span className="sr-only">
        : {AUDIENCE[drop.audience]}, {drop.lossPp.toFixed(1)} points
      </span>
    </Badge>
  );
}

/**
 * The channel's videos from the one index document, searchable by title and
 * sortable. A table on wide screens, a list of cards on a phone; each video
 * opens its autopsy.
 */
export function VideoList({ videos }: { videos: readonly VideoListItem[] }) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("newest");
  const shown = useMemo(() => {
    const words = query.trim().toLowerCase();
    return videos
      .filter((video) => !words || video.title.toLowerCase().includes(words))
      .toSorted(SORTS[sort].by);
  }, [videos, query, sort]);

  const field = cn("rounded-[4px] border-2 border-ink bg-surface px-3 py-2", FOCUS_RING);
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm text-ink-muted sm:max-w-sm">
          Search titles
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className={cn(field, "text-base text-ink")}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-muted">
          Sort
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            className={cn(field, "text-base text-ink")}
          >
            {(Object.keys(SORTS) as Sort[]).map((key) => (
              <option key={key} value={key}>
                {SORTS[key].label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="text-sm text-ink-muted" aria-live="polite">
        {shown.length === videos.length
          ? `${videos.length} videos`
          : `${shown.length} of ${videos.length} videos`}
      </p>

      {shown.length ? (
        <div className="flex flex-col gap-2">
          <div
            aria-hidden="true"
            className="hidden grid-cols-[120px_minmax(0,1fr)_7rem_5rem_7rem_11.5rem] gap-x-4 px-3.5 text-sm text-ink-muted md:grid"
          >
            <span />
            <span>Video</span>
            <span>Published</span>
            <span>Length</span>
            <span>Average view</span>
            <span>Biggest drop-off</span>
          </div>
          <ul className="flex flex-col gap-3">
            {shown.map((video) => (
              <li key={video.videoId}>
                <Link
                  href={`/app/videos/${video.videoId}`}
                  className={cn(
                    "grid grid-cols-[96px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[4px] border-2 border-ink bg-surface p-3",
                    "transition-[translate,box-shadow] duration-[120ms] hover:-translate-x-1 hover:-translate-y-1 hover:shadow-hard motion-reduce:transition-none motion-reduce:hover:translate-x-0 motion-reduce:hover:translate-y-0",
                    "md:grid-cols-[120px_minmax(0,1fr)_7rem_5rem_7rem_11.5rem]",
                    FOCUS_RING,
                  )}
                >
                  {video.thumbnailUrl ? (
                    <Image
                      src={video.thumbnailUrl}
                      alt=""
                      width={120}
                      height={68}
                      className="row-span-2 aspect-video w-full rounded-[2px] border-2 border-ink object-cover md:row-span-1"
                    />
                  ) : (
                    <span
                      aria-hidden="true"
                      className="row-span-2 aspect-video w-full rounded-[2px] border-2 border-ink bg-bg md:row-span-1"
                    />
                  )}
                  <span className="flex min-w-0 flex-col gap-1">
                    <span className="truncate font-medium">{video.title}</span>
                    {video.inSample ? null : <Badge className="text-xs">Held out</Badge>}
                  </span>
                  <span className="col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted tabular-nums md:contents">
                    <span className="md:text-ink">
                      <span className="sr-only">Published </span>
                      {date.format(new Date(video.publishedAt))}
                    </span>
                    <span className="font-mono md:text-ink">
                      <span className="sr-only">Length </span>
                      {formatClock(video.durationS)}
                    </span>
                    <span className="md:text-ink">
                      {video.avgViewPct === null ? "—" : formatPercent(video.avgViewPct)}
                      <span className="sr-only"> average view</span>
                    </span>
                    <DropChip drop={video.biggestDrop} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-lg text-ink-muted">No video title contains &ldquo;{query}&rdquo;.</p>
      )}
    </div>
  );
}
