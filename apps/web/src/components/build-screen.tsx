"use client";

import type { ChannelView } from "@soundcheck/core/schemas";
import { Button, buttonVariants } from "@soundcheck/ui/components/button";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import useSWR from "swr";
import { BUILD_STEPS, buildSteps, isBusy } from "@/lib/build-steps";
import { formatCount } from "@/lib/format";
import { BuildProgress } from "./build-progress";

/** How often the screen asks for the build's progress while it runs. */
export const POLL_MS = 3000;

async function fetchChannel(url: string): Promise<ChannelView> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`The channel answered ${response.status}`);
  return (await response.json()) as ChannelView;
}

/** Why a build could not start, in words, from the route's error code. */
const START_ERRORS: Record<string, string> = {
  builds_not_configured:
    "Builds can't start here: this copy of Soundcheck has no build workflow set up.",
  fixtures_mode: "This is fixture data, which is read-only, so a build can't start.",
};

function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">{title}</h1>
      {children ? (
        <div className="flex max-w-2xl flex-col gap-3 text-lg text-ink-muted">{children}</div>
      ) : null}
    </div>
  );
}

/**
 * The build screen: the five steps with live progress while the build runs
 * (polled every 3 s, stopping once it ends), and what to do when it failed,
 * found too few videos, has not started, or is ready.
 */
export function BuildScreen({
  initial,
  hasPreview,
  minVideos,
  minViews,
}: {
  initial: ChannelView;
  /** A summary from an earlier publish exists, so the audiences can be previewed. */
  hasPreview: boolean;
  minVideos: number;
  minViews: number;
}) {
  const { data, mutate } = useSWR(`/api/v1/channels/${initial.id}`, fetchChannel, {
    fallbackData: initial,
    refreshInterval: (latest) => (latest && isBusy(latest.build) ? POLL_MS : 0),
  });
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const build = (data ?? initial).build;
  const steps = buildSteps(build);
  const current = steps.find((step) => step.status === "current");

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      const response = await fetch(`/api/v1/channels/${initial.id}/build`, { method: "POST" });
      if (response.status !== 202 && response.status !== 409) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setStartError(
          START_ERRORS[body.error ?? ""] ?? "The build didn't start. Please try again in a minute.",
        );
      }
      await mutate();
    } finally {
      setStarting(false);
    }
  }

  const startButton = (label: string, variant: "primary" | "secondary" = "primary") => (
    <Button onClick={start} disabled={starting} variant={variant}>
      {starting ? "Starting…" : label}
    </Button>
  );

  let header: ReactNode;
  let actions: ReactNode = null;
  switch (build.state) {
    case "ready":
      header = <Heading title="Your audiences are ready" />;
      actions = (
        <Link href="/app/audiences" className={buttonVariants()}>
          See your audiences
        </Link>
      );
      break;
    case "failed": {
      const where = BUILD_STEPS.find((step) =>
        (step.stages as readonly string[]).includes(build.stage ?? ""),
      );
      header = (
        <Heading title="The build stopped">
          <p>
            Something went wrong {where ? `while ${where.label.toLowerCase()}` : "while starting"}.
            Your data is safe, and trying again usually works.
          </p>
          {build.error ? (
            <p className="font-mono text-sm break-words">Details: {build.error}</p>
          ) : null}
        </Heading>
      );
      actions = startButton("Try again");
      break;
    }
    case "insufficient_data":
      header = (
        <Heading title="Not enough videos yet">
          <p>
            To learn how your audiences watch, Soundcheck needs at least{" "}
            <strong className="text-ink">{formatCount(minVideos)} videos</strong> with a complete
            retention curve from YouTube. Your channel has{" "}
            <strong className="text-ink">{formatCount(build.usableVideos ?? 0)}</strong>
            {build.eligibleVideos !== undefined
              ? ` of ${formatCount(build.eligibleVideos)} eligible videos`
              : ""}
            .
          </p>
          <p>
            A video counts when it is not a Short, is at least a week old, lasts between 1 minute
            and 3 hours, and has at least {formatCount(minViews)} views; YouTube adds its curve once
            enough people have watched. When you have more, choose Check again.
          </p>
        </Heading>
      );
      actions = (
        <div className="flex flex-wrap items-center gap-4">
          {hasPreview ? (
            <Link href="/app/audiences" className={buttonVariants()}>
              See the preview anyway
            </Link>
          ) : null}
          {startButton("Check again", hasPreview ? "secondary" : "primary")}
        </div>
      );
      break;
    case "not_started":
      header = (
        <Heading title="Your channel hasn't been analysed yet">
          <p>
            The analysis reads your videos and how each audience watched them. It runs on its own
            once started.
          </p>
        </Heading>
      );
      actions = startButton("Start");
      break;
    default:
      header = (
        <Heading title="Learning how your audiences watch">
          <p>
            This takes a few minutes for a small channel and up to a couple of hours for a large
            one. You can close this tab: it keeps going, and this page shows where it is when you
            come back.
          </p>
        </Heading>
      );
  }

  return (
    <div className="flex flex-col gap-8">
      {header}
      {build.state === "not_started" ? null : <BuildProgress steps={steps} />}
      {actions ? <div>{actions}</div> : null}
      {startError ? (
        <p role="alert" className="max-w-2xl rounded-[4px] border-2 border-ink bg-surface p-4">
          {startError}
        </p>
      ) : null}
      <p className="sr-only" aria-live="polite">
        {current
          ? `Now: ${current.label}`
          : build.state === "ready"
            ? "The build is finished."
            : ""}
      </p>
    </div>
  );
}
