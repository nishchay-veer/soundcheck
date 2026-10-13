"use client";

import {
  AUDIENCE_LABELS,
  SCENARIO_LABELS,
  soundcheckDocSchema,
  type SoundcheckDoc,
} from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { buttonVariants } from "@soundcheck/ui/components/button";
import { cn } from "@soundcheck/ui/lib/utils";
import Link from "next/link";
import { useRef, useState } from "react";
import useSWR from "swr";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import {
  KIND_LABELS,
  durationRange,
  isActive,
  percentRange,
  predictedSeries,
  soundcheckSteps,
  soundcheckTitle,
  unusableReasons,
} from "@/lib/soundcheck";
import { formatClock } from "@/lib/format";
import { AutopsyChart } from "./autopsy-chart";
import { BuildProgress } from "./build-progress";
import { ResultNotice } from "./result-notice";
import { StatCard } from "./stat-card";
import { YouTubePlayer, type PlayerHandle } from "./youtube-player";

/** While the job runs, the page asks for news this often. */
export const SOUNDCHECK_POLL_MS = 2_000;

const date = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

async function fetchSoundcheck(url: string): Promise<SoundcheckDoc> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load the soundcheck: ${response.status}`);
  return soundcheckDocSchema.parse(await response.json());
}

/**
 * One soundcheck: its live progress (polled every 2 s while the job works),
 * what went wrong and what to do when it failed, or its prediction.
 */
export function SoundcheckView({
  channelId,
  initial,
}: {
  channelId: string;
  initial: SoundcheckDoc;
}) {
  const { data } = useSWR(
    `/api/v1/channels/${channelId}/soundchecks/${initial.soundcheckId}`,
    fetchSoundcheck,
    {
      fallbackData: initial,
      refreshInterval: (latest) => (latest && isActive(latest.status) ? SOUNDCHECK_POLL_MS : 0),
    },
  );
  const doc = data ?? initial;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <Link href="/app/soundcheck" className="w-fit text-sm underline underline-offset-4">
          All soundchecks
        </Link>
        <h1 className="font-heading text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">
          {soundcheckTitle(doc)}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-muted">
          <span>{date.format(new Date(doc.createdAt))}</span>
          {doc.durationS ? <span className="font-mono">{formatClock(doc.durationS)}</span> : null}
          <Badge variant="plain">{KIND_LABELS[doc.input.kind]}</Badge>
          <Badge variant="plain">Expected traffic: {SCENARIO_LABELS[doc.scenario]}</Badge>
        </p>
      </div>
      {doc.status === "ready" ? (
        <SoundcheckResult doc={doc} />
      ) : doc.status === "failed" ? (
        <Failed doc={doc} />
      ) : (
        <Running doc={doc} />
      )}
    </div>
  );
}

function Running({ doc }: { doc: SoundcheckDoc }) {
  if (doc.status === "awaiting_upload") {
    return (
      <section aria-live="polite" className="flex max-w-2xl flex-col gap-3">
        <h2 className="font-heading text-[28px] font-bold tracking-tight">
          Waiting for the upload
        </h2>
        <p className="text-lg">
          The soundcheck starts as soon as your file finishes uploading. If you closed the page
          while it was uploading, start a new soundcheck.
        </p>
      </section>
    );
  }
  const steps = soundcheckSteps(doc);
  const current = steps.find((step) => step.status === "current");
  return (
    <section aria-live="polite" className="flex max-w-2xl flex-col gap-4">
      <h2 className="font-heading text-[28px] font-bold tracking-tight">
        {current?.message ?? (doc.status === "queued" ? "Starting" : (current?.label ?? "Running"))}
      </h2>
      <BuildProgress steps={steps} />
      <p className="text-ink-muted">
        This takes a few minutes. You can leave this page; the soundcheck keeps running.
      </p>
    </section>
  );
}

function Failed({ doc }: { doc: SoundcheckDoc }) {
  return (
    <section
      role="alert"
      className="flex max-w-2xl flex-col gap-4 rounded-[4px] border-2 border-ink bg-surface p-5"
    >
      <h2 className="font-heading text-[28px] font-bold tracking-tight">
        This soundcheck didn&apos;t finish
      </h2>
      <p className="text-lg">{doc.error?.message}</p>
      <div>
        <Link href="/app/soundcheck/new" className={buttonVariants()}>
          New soundcheck
        </Link>
      </div>
    </section>
  );
}

/** The prediction: totals with ranges, each audience, and the curves over the beats. */
export function SoundcheckResult({ doc }: { doc: SoundcheckDoc }) {
  const player = useRef<PlayerHandle>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const prediction = doc.prediction;
  if (!prediction || !doc.durationS) return null;
  const reasons = unusableReasons(prediction);
  const linked = doc.input.kind === "youtube" ? doc.input.videoId : null;
  const seek = (seconds: number) => {
    setPlayhead(seconds);
    player.current?.seekTo(seconds);
  };

  return (
    <div className="flex flex-col gap-8">
      {reasons.length ? <ResultNotice reasons={reasons} /> : null}

      <section aria-label="Prediction" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label="Predicted average view"
          value={formatClock(prediction.avdS.p50)}
          detail={`${formatClock(prediction.avdS.p10)} to ${formatClock(prediction.avdS.p90)}`}
        />
        <StatCard
          label="Of the cut"
          value={`${Math.round(prediction.avp.p50)}%`}
          detail={`${Math.round(prediction.avp.p10)} to ${Math.round(prediction.avp.p90)}%`}
        />
        <StatCard
          label="Your recent videos"
          value={
            prediction.percentileVsChannel === null
              ? "–"
              : `Better than ${Math.round(prediction.percentileVsChannel)}%`
          }
          detail={
            prediction.comparedVideos
              ? `of your ${prediction.comparedVideos} recent video${prediction.comparedVideos === 1 ? "" : "s"}, by average view`
              : "No recent videos to compare with"
          }
        />
      </section>

      {doc.narrative ? <p className="max-w-3xl text-lg">{doc.narrative}</p> : null}

      <section aria-labelledby="audiences-title" className="flex flex-col gap-3">
        <h2 id="audiences-title" className="font-heading text-[28px] font-bold tracking-tight">
          Each audience
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {(["subscribed", "unsubscribed"] as const).map((key) => {
            const audience = prediction.audiences[key];
            if (!audience) return null;
            return (
              <li
                key={key}
                className="flex flex-col gap-2 rounded-[4px] border-2 border-ink bg-surface p-4"
              >
                <span className="flex items-center gap-2 font-heading text-xl font-bold">
                  <span
                    aria-hidden="true"
                    className="h-3 w-6 rounded-full border border-ink"
                    style={{ background: AUDIENCE_COLOR[key] }}
                  />
                  {AUDIENCE_LABELS[key]}
                  <span className="ml-auto text-sm font-normal text-ink-muted">
                    {Math.round(prediction.weights[key] * 100)}% of views
                  </span>
                </span>
                <span className="tabular-nums">Average view {durationRange(audience.avdS)}</span>
                <span className="tabular-nums">Of the cut {percentRange(audience.avp)}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {/* The player sits beside the chart on a desktop; an upload has none, so the chart is full width. */}
      <div
        className={cn(
          "grid grid-cols-[minmax(0,1fr)] gap-6",
          linked && "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start",
        )}
      >
        <AutopsyChart
          id={`soundcheck-${doc.soundcheckId}`}
          title="Who is predicted to still be watching"
          durationS={doc.durationS}
          series={predictedSeries(prediction)}
          beats={doc.beats ?? []}
          drops={[]}
          selectedDropId={null}
          onSelectDrop={() => undefined}
          onSeek={seek}
          playheadS={playhead}
          predicted
        />
        {linked ? (
          <YouTubePlayer
            ref={player}
            videoId={linked}
            title={soundcheckTitle(doc)}
            onTime={setPlayhead}
          />
        ) : null}
      </div>
      <p className="text-sm text-ink-muted">
        Predicted with your channel&apos;s models for {SCENARIO_LABELS[doc.scenario].toLowerCase()}{" "}
        traffic. Each range is the middle 80% of 200 simulations.
      </p>
    </div>
  );
}
