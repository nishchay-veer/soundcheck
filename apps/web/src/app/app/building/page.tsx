import { NotFoundError } from "@soundcheck/core";
import { getSummary } from "@soundcheck/core/data";
import { pickServerEnv } from "@soundcheck/core/env";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BuildScreen } from "@/components/build-screen";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Building · Soundcheck" };

/** Where the channel's build is, live; and what to do when it failed or found too few videos. */
export default async function BuildingPage() {
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
  const [summary, env] = await Promise.all([
    getSummary(userId, channel.id),
    Promise.resolve(pickServerEnv(["MIN_TRAIN_VIDEOS", "MIN_VIEWS"])),
  ]);
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col px-4 py-12 sm:px-6">
      <BuildScreen
        initial={channel}
        hasPreview={summary !== null}
        minVideos={env.MIN_TRAIN_VIDEOS}
        minViews={env.MIN_VIEWS}
      />
    </main>
  );
}
