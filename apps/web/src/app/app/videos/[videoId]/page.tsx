import { NotFoundError } from "@soundcheck/core";
import { getVideo } from "@soundcheck/core/data";
import { Badge } from "@soundcheck/ui/components/badge";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ResultNotice } from "@/components/result-notice";
import { StatCard } from "@/components/stat-card";
import { VideoAutopsy } from "@/components/video-autopsy";
import { currentChannel } from "@/lib/channel";
import { formatClock, formatCount, formatPercent } from "@/lib/format";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Video · Soundcheck" };

const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** One video's autopsy: its audiences' curves over its beats, and why each drop-off happened. */
export default async function VideoPage({ params }: { params: Promise<{ videoId: string }> }) {
  const { videoId } = await params;
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
  let video;
  try {
    video = await getVideo(userId, channel.id, videoId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const reasons = [
    ...new Set(
      Object.values(video.audiences).flatMap((audience) =>
        audience?.model && !audience.model.usable ? audience.model.unusableReasons : [],
      ),
    ),
  ];
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <Link href="/app/videos" className="w-fit text-sm underline underline-offset-4">
          All videos
        </Link>
        <h1 className="font-heading text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">
          {video.title}
        </h1>
        <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-ink-muted">
          <span>{date.format(new Date(video.publishedAt))}</span>
          <span className="font-mono">{formatClock(video.durationS)}</span>
          {video.inSample ? (
            <Badge variant="plain">This video was used to train your model</Badge>
          ) : (
            <Badge>Held out: predicted before we looked</Badge>
          )}
        </p>
      </div>

      {video.stats ? (
        <section aria-label="Totals" className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <StatCard label="Views" value={formatCount(video.stats.views)} />
          <StatCard label="Average watch" value={formatClock(video.stats.avdS)} />
          <StatCard label="Average view" value={formatPercent(video.stats.avp)} />
        </section>
      ) : null}

      {reasons.length ? <ResultNotice reasons={reasons} /> : null}

      <VideoAutopsy video={video} />
    </main>
  );
}
