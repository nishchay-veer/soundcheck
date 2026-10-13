import { NotFoundError } from "@soundcheck/core";
import { getSoundcheck } from "@soundcheck/core/data";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { SoundcheckView } from "@/components/soundcheck-view";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Soundcheck · Soundcheck" };

/** One soundcheck: its progress while it runs, then its prediction. */
export default async function SoundcheckPage({
  params,
}: {
  params: Promise<{ soundcheckId: string }>;
}) {
  const { soundcheckId } = await params;
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
  let soundcheck;
  try {
    soundcheck = await getSoundcheck(userId, channel.id, soundcheckId);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <SoundcheckView channelId={channel.id} initial={soundcheck} />
    </main>
  );
}
