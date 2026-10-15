"use client";

import {
  AUDIENCE_LABELS,
  SCENARIO_LABELS,
  simulationSchema,
  soundcheckDocSchema,
  type Edit,
  type SoundcheckDoc,
} from "@soundcheck/core/schemas";
import { Badge } from "@soundcheck/ui/components/badge";
import { buttonVariants } from "@soundcheck/ui/components/button";
import Link from "next/link";
import { useRef, useState } from "react";
import useSWR from "swr";
import { AUDIENCE_COLOR } from "@/lib/audiences";
import { marksFor, toEdited, toOriginal, type Objective } from "@/lib/edits";
import { standingOf } from "@/lib/model-standing";
import {
  KIND_LABELS,
  SCENARIO_ASSUMPTIONS,
  durationRange,
  isActive,
  percentRange,
  predictedSeries,
  soundcheckSteps,
  soundcheckTitle,
} from "@/lib/soundcheck";
import { formatClock } from "@/lib/format";
import { useDebounced } from "@/lib/use-debounced";
import { AutopsyChart } from "./autopsy-chart";
import { BuildProgress } from "./build-progress";
import { CutExports } from "./cut-exports";
import { CutStrip } from "./cut-strip";
import { EditPanel } from "./edit-panel";
import { ResultNotice } from "./result-notice";
import { StatCard } from "./stat-card";
import { YouTubePlayer, type PlayerHandle } from "./youtube-player";

/** While the job runs, the page asks for news this often. */
export const SOUNDCHECK_POLL_MS = 2_000;
/** Edits are simulated once the ticks have been still this long. */
export const EDIT_DEBOUNCE_MS = 250;

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

const SIMULATE_FAILED = "These edits could not be simulated. Please try again.";
/** What a failed simulation says, by status. */
const SIMULATE_ERRORS: Partial<Record<number, string>> = {
  400: "These edits can't go together. Untick one and try again.",
  409: "This soundcheck isn't ready for edits yet. Reload the page in a minute.",
};

async function simulate(url: string, edits: readonly Edit["edit"][]) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ edits }),
  });
  if (!response.ok) throw new Error(SIMULATE_ERRORS[response.status] ?? SIMULATE_FAILED);
  return simulationSchema.parse(await response.json());
}

/**
 * The prediction: totals with ranges, each audience, the curves over the
 * beats, and the suggested edits. Ticking edits simulates them together
 * (250 ms after the last change); the totals, audiences, curves and chapters
 * then describe the edited cut.
 */
export function SoundcheckResult({ doc }: { doc: SoundcheckDoc }) {
  const player = useRef<PlayerHandle>(null);
  const [playhead, setPlayhead] = useState<number | null>(null);
  const prediction = doc.prediction;
  const standing = prediction ? standingOf(prediction.audiences) : { notUsable: [], usable: [] };
  // Edits are recommended only when every audience's model is usable.
  const usable = standing.notUsable.length === 0;
  const [objective, setObjective] = useState<Objective>("avd");
  const [ticked, setTicked] = useState<ReadonlySet<string>>(
    () =>
      new Set(
        usable ? doc.edits.filter((edit) => edit.recommended).map((edit) => edit.editId) : [],
      ),
  );
  const settled = useDebounced(ticked, EDIT_DEBOUNCE_MS);
  const ids = [...settled].sort();
  const url = `/api/v1/channels/${doc.channelId}/soundchecks/${doc.soundcheckId}/simulate`;
  // The answer has both objectives' numbers, so switching objective asks for nothing.
  const { data, error, isLoading } = useSWR(
    ids.length ? [url, ids.join(",")] : null,
    ([key]) =>
      simulate(
        key,
        doc.edits.filter((edit) => ids.includes(edit.editId)).map((edit) => edit.edit),
      ),
    { keepPreviousData: true, revalidateOnFocus: false },
  );
  if (!prediction || !doc.durationS || !doc.beats) return null;
  const beats = doc.beats;
  const simulation = ids.length && ticked.size ? (data ?? null) : null;
  const chosen = doc.edits.filter((edit) => ticked.has(edit.editId));
  const linked = doc.input.kind === "youtube" ? doc.input.videoId : null;

  // The chart shows the edited cut; the player plays the cut as it is.
  const shown = simulation
    ? {
        durationS: simulation.durationS,
        series: (["subscribed", "unsubscribed"] as const).flatMap((key) => {
          const audience = simulation.audiences[key];
          return audience
            ? [{ key, label: AUDIENCE_LABELS[key], actual: null, band: audience.band }]
            : [];
        }),
        beats: simulation.spans.flatMap((span) => {
          const beat = beats[span.beat];
          return beat ? [{ ...beat, startS: span.startS, endS: span.endS }] : [];
        }),
        avdS: simulation.avdS,
        avp: simulation.avp,
        audiences: simulation.audiences,
      }
    : {
        durationS: doc.durationS,
        series: predictedSeries(prediction),
        beats,
        avdS: prediction.avdS,
        avp: prediction.avp,
        audiences: prediction.audiences,
      };
  const seek = (seconds: number) => {
    const original = simulation ? toOriginal(simulation.spans, seconds) : seconds;
    if (original === null) return;
    setPlayhead(seconds);
    player.current?.seekTo(original);
  };
  const follow = (seconds: number) =>
    setPlayhead(simulation ? toEdited(simulation.spans, seconds) : seconds);
  const toggle = (editId: string) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(editId)) next.add(editId);
      return next;
    });
  const withEdits = chosen.length
    ? ` with ${chosen.length} edit${chosen.length === 1 ? "" : "s"}`
    : "";

  return (
    <div className="flex flex-col gap-8">
      <ResultNotice standing={standing} />

      <section aria-label="Prediction" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
        <StatCard
          label={`Predicted average view${withEdits}`}
          value={formatClock(shown.avdS.p50)}
          detail={
            <>
              {formatClock(shown.avdS.p10)} to {formatClock(shown.avdS.p90)}
              {simulation ? (
                <span className="block">
                  As it is: {formatClock(prediction.avdS.p50)} ({formatClock(prediction.avdS.p10)}{" "}
                  to {formatClock(prediction.avdS.p90)})
                </span>
              ) : null}
            </>
          }
        />
        <StatCard
          label={`Of the cut${withEdits}`}
          value={`${Math.round(shown.avp.p50)}%`}
          detail={
            <>
              {Math.round(shown.avp.p10)} to {Math.round(shown.avp.p90)}% of{" "}
              {formatClock(shown.durationS)}
              {simulation ? (
                <span className="block">
                  As it is: {Math.round(prediction.avp.p50)}% of {formatClock(doc.durationS)}
                </span>
              ) : null}
            </>
          }
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
              ? `of your ${prediction.comparedVideos} recent video${prediction.comparedVideos === 1 ? "" : "s"}, by average view (the cut as it is)`
              : "No recent videos to compare with"
          }
        />
      </section>

      {doc.narrative && !chosen.length ? (
        <p className="max-w-3xl text-lg">{doc.narrative}</p>
      ) : null}

      <section aria-labelledby="audiences-title" className="flex flex-col gap-3">
        <h2 id="audiences-title" className="font-heading text-[28px] font-bold tracking-tight">
          Each audience{withEdits}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 sm:gap-4">
          {(["subscribed", "unsubscribed"] as const).map((key) => {
            const audience = shown.audiences[key];
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

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex flex-col gap-6">
          <AutopsyChart
            id={`soundcheck-${doc.soundcheckId}`}
            title={`Who is predicted to still be watching${withEdits}`}
            durationS={shown.durationS}
            series={shown.series}
            beats={shown.beats}
            drops={[]}
            selectedDropId={null}
            onSelectDrop={() => undefined}
            onSeek={seek}
            playheadS={playhead}
            predicted
          />
          {chosen.length ? (
            <CutStrip
              beats={beats}
              durationS={doc.durationS}
              marks={marksFor(chosen)}
              onSeek={(seconds) => player.current?.seekTo(seconds)}
            />
          ) : null}
        </div>
        <div className="flex flex-col gap-6">
          {linked ? (
            <YouTubePlayer
              ref={player}
              videoId={linked}
              title={soundcheckTitle(doc)}
              onTime={follow}
            />
          ) : null}
          <EditPanel
            edits={doc.edits}
            objective={objective}
            onObjective={setObjective}
            ticked={ticked}
            onToggle={toggle}
            usable={usable}
            together={simulation?.delta ?? null}
            pending={isLoading || settled !== ticked}
            error={error ? (error as Error).message : null}
          />
        </div>
      </div>

      <CutExports
        title={soundcheckTitle(doc)}
        edits={chosen}
        beats={beats}
        durationS={doc.durationS}
        chapters={doc.chapters}
        spans={simulation?.spans ?? null}
        editedDurationS={simulation?.durationS ?? doc.durationS}
      />

      <p className="text-sm text-ink-muted">
        Predicted with your channel&apos;s models, assuming {SCENARIO_ASSUMPTIONS[doc.scenario]}.
        Each range is the middle 80% of 200 simulations, and edits are compared on the same ones.
      </p>
    </div>
  );
}
