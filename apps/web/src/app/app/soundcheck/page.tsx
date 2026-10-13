import { NotFoundError } from "@soundcheck/core";
import { getSummary, listSoundchecks } from "@soundcheck/core/data";
import { buttonVariants } from "@soundcheck/ui/components/button";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { SoundcheckList } from "@/components/soundcheck-list";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export const metadata: Metadata = { title: "Soundchecks · Soundcheck" };

/** The channel's soundchecks, newest first, and the way to start one. */
export default async function SoundchecksPage() {
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
  const [summary, soundchecks] = await Promise.all([
    getSummary(userId, channel.id),
    listSoundchecks(userId, channel.id),
  ]);
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-4 py-12 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
            Soundcheck
          </h1>
          <p className="text-lg text-ink-muted">
            See how a new cut is likely to do with each audience before you publish it.
          </p>
        </div>
        {summary ? (
          <Link href="/app/soundcheck/new" className={buttonVariants()}>
            New soundcheck
          </Link>
        ) : null}
      </div>
      {!summary ? (
        <p className="max-w-2xl text-lg">
          Soundchecks use your channel&apos;s models, so they start after its first build.{" "}
          <Link href="/app/building" className="underline underline-offset-4">
            See the build
          </Link>
          .
        </p>
      ) : soundchecks.length ? (
        <SoundcheckList soundchecks={soundchecks} />
      ) : (
        <p className="max-w-2xl text-lg text-ink-muted">
          No soundchecks yet. Upload a rough cut or paste an unlisted link to see how it might do.
        </p>
      )}
    </main>
  );
}
