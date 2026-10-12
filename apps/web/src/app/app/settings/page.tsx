import { NotFoundError } from "@soundcheck/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ChannelCard } from "@/components/channel-card";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Channel · Soundcheck" };

/** The channel's details, and disconnecting it, which deletes everything Soundcheck stored. */
export default async function SettingsPage() {
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
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">Channel</h1>
      <ChannelCard channel={channel} />
    </main>
  );
}
