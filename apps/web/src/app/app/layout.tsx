import { NotFoundError } from "@soundcheck/core";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppNav } from "@/components/app-nav";
import { currentChannel } from "@/lib/channel";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/** Every signed-in screen: the app bar, then the page. */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const userId = await currentUserId();
  if (!userId) redirect("/");
  let current;
  try {
    current = await currentChannel(userId);
  } catch (error) {
    if (error instanceof NotFoundError) redirect("/");
    throw error;
  }
  return (
    <>
      <AppNav
        channels={current.me.channels.map(({ id, title }) => ({ id, title }))}
        currentId={current.channel?.id ?? null}
      />
      {children}
    </>
  );
}
