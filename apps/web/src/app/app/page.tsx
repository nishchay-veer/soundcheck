import { NotFoundError } from "@soundcheck/core";
import { getMe } from "@soundcheck/core/data";
import { redirect } from "next/navigation";
import { ChannelCard } from "@/components/channel-card";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

export default async function AppPage() {
  const userId = await currentUserId();
  if (!userId) redirect("/");

  let me;
  try {
    me = await getMe(userId);
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/");
    throw error;
  }

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-6 py-12">
      <h1 className="font-heading text-[40px] leading-tight font-bold tracking-tight">
        Your channel
      </h1>
      {me.channels.length > 0 ? (
        me.channels.map((channel) => <ChannelCard key={channel.id} channel={channel} />)
      ) : (
        <p className="text-lg text-ink-muted">No channel is connected to this account.</p>
      )}
    </main>
  );
}
