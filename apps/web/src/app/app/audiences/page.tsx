import { NotFoundError } from "@soundcheck/core";
import { getSummary } from "@soundcheck/core/data";
import { pickServerEnv } from "@soundcheck/core/env";
import { EVALUATION_SPLIT, heldOutMinimum } from "@soundcheck/core/model";
import type { SummaryEvaluation } from "@soundcheck/core/schemas";
import { buttonVariants } from "@soundcheck/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AudienceGrid } from "@/components/audience-grid";
import { ResultNotice } from "@/components/result-notice";
import { StatCard } from "@/components/stat-card";
import { modelStanding } from "@/lib/model-standing";
import { currentChannel } from "@/lib/channel";
import { formatCount } from "@/lib/format";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Audiences · Soundcheck" };

const MODEL_ERROR_HINT =
  "On videos the model never saw: how far its predicted curves are from the real ones, on average, in percentage points. The channel's average curve is the baseline to beat.";

function modelError(evaluation: SummaryEvaluation | null, minTrainVideos: number) {
  if (!evaluation) {
    return {
      value: "Not measured",
      detail: `Soundcheck checks its accuracy once you have ${heldOutMinimum(minTrainVideos)} videos at least ${EVALUATION_SPLIT.minAgeDays} days old`,
    };
  }
  return {
    value: `${evaluation.modelErrorPp.toFixed(1)} pp`,
    detail: `Channel average ${evaluation.baselineErrorPp.toFixed(1)} pp; ${
      evaluation.beatsBaseline ? "the model beats it" : "no clear win over it yet"
    }`,
  };
}

/** The home screen once a channel is built: who watches, and how each audience watches. */
export default async function AudiencesPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string | string[]; effect?: string | string[] }>;
}) {
  const query = await searchParams;
  const focus =
    typeof query.audience === "string" && typeof query.effect === "string"
      ? { audience: query.audience, effect: query.effect }
      : null;
  const userId = await currentUserId();
  if (!userId) redirect("/");
  let channel;
  try {
    ({ channel } = await currentChannel(userId));
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/");
    throw error;
  }
  if (!channel) redirect("/app");
  if (channel.status === "reauth_required") redirect("/reauth");
  const summary = await getSummary(userId, channel.id);
  if (!summary && channel.build.state !== "ready") redirect("/app/building");

  const standing = modelStanding(summary?.audiences ?? []);
  const error = modelError(
    summary?.evaluation ?? null,
    pickServerEnv(["MIN_TRAIN_VIDEOS"]).MIN_TRAIN_VIDEOS,
  );
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
          Your audiences
        </h1>
        <p className="text-lg text-ink-muted">{channel.title}</p>
      </div>

      {!summary ? (
        <div className="flex flex-col gap-4">
          <p className="max-w-2xl text-lg">
            Your audiences appear here once the first build has published them.
          </p>
          <div>
            <Link href="/app/building" className={buttonVariants({ variant: "secondary" })}>
              See the build
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ResultNotice standing={standing} />
          {channel.build.state !== "ready" ? (
            <p className="max-w-2xl text-ink-muted">
              This is a preview from your last build.{" "}
              <Link href="/app/building" className="underline underline-offset-4">
                See why
              </Link>
              .
            </p>
          ) : null}

          {/* Three counts side by side on a phone, the model error below at full width. */}
          <section aria-label="Overview" className="grid grid-cols-3 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard label="Videos analysed" value={formatCount(summary.videosAnalysed)} />
            <StatCard
              label="Audiences found"
              value={formatCount(summary.audiences.length)}
              hint="Subscribers and newcomers are measured by YouTube. Newcomers by traffic source appear when your videos differ enough to tell them apart."
            />
            <StatCard label="Beats extracted" value={formatCount(summary.beatsExtracted)} />
            <StatCard
              label="Model error"
              value={error.value}
              detail={error.detail}
              hint={MODEL_ERROR_HINT}
              className="col-span-3 lg:col-span-1"
            />
          </section>

          <p className="rounded-[4px] border-2 border-ink bg-highlight p-5 font-heading text-[22px] leading-snug font-bold tracking-tight sm:p-6 sm:text-[28px]">
            {summary.headline}
          </p>

          {summary.audiences.length ? (
            <section aria-labelledby="audience-details" className="flex flex-col gap-6">
              <h2 id="audience-details" className="sr-only">
                Audience details
              </h2>
              <AudienceGrid cards={summary.audiences} focus={focus} />
            </section>
          ) : (
            <p className="text-lg text-ink-muted">No audience has enough views to describe yet.</p>
          )}

          <p className="text-sm text-ink-muted">
            Updated{" "}
            {new Date(summary.generatedAt).toLocaleDateString("en-GB", {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </p>
        </>
      )}
    </main>
  );
}
