import { NotFoundError } from "@soundcheck/core";
import { redirect } from "next/navigation";
import { appHome } from "@/lib/app-home";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/** Sends the user to the screen their channel's build state calls for. */
export default async function AppPage() {
  const userId = await currentUserId();
  if (!userId) redirect("/");
  let channel;
  try {
    ({ channel } = await currentChannel(userId));
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/");
    throw error;
  }
  if (channel) redirect(appHome(channel));
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-4 px-4 py-12 sm:px-6">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
        No channel yet
      </h1>
      <p className="text-lg text-ink-muted">No channel is connected to this account.</p>
    </main>
  );
}
