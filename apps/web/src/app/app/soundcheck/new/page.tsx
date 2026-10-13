import { NotFoundError } from "@soundcheck/core";
import { getSummary } from "@soundcheck/core/data";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SoundcheckForm } from "@/components/soundcheck-form";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "New soundcheck · Soundcheck" };

/** A new soundcheck: an uploaded cut or a YouTube link. */
export default async function NewSoundcheckPage() {
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
  if (!(await getSummary(userId, channel.id))) redirect("/app/soundcheck");
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-col gap-3">
        <Link href="/app/soundcheck" className="w-fit text-sm underline underline-offset-4">
          All soundchecks
        </Link>
        <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
          New soundcheck
        </h1>
        <p className="max-w-2xl text-lg text-ink-muted">
          Upload a rough cut, or link a public or unlisted video. In a few minutes you&apos;ll see
          how long each audience is likely to watch it.
        </p>
      </div>
      <SoundcheckForm channelId={channel.id} />
    </main>
  );
}
