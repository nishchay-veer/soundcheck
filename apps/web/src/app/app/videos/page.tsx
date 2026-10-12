import { NotFoundError } from "@soundcheck/core";
import { listVideos } from "@soundcheck/core/data";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { VideoList } from "@/components/video-list";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Videos · Soundcheck" };

/** Every published video, from the one index document; each opens its autopsy. */
export default async function VideosPage() {
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
  const index = await listVideos(userId, channel.id);
  if (!index && channel.build.state !== "ready") redirect("/app/building");
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">Videos</h1>
        <p className="text-lg text-ink-muted">{channel.title}</p>
      </div>
      {index && index.videos.length ? (
        <VideoList videos={index.videos} />
      ) : (
        <p className="text-lg text-ink-muted">No videos have been published yet.</p>
      )}
    </main>
  );
}
