import type { ChannelView } from "@soundcheck/core/schemas";

export type AppHome = "/reauth" | "/app/audiences" | "/app/building";

/**
 * Where `/app` sends a channel: to reconnect when YouTube revoked access, to
 * its audiences once built, and to the build screen otherwise (not started,
 * queued, running, failed, or not enough videos; that screen explains each).
 */
export function appHome(channel: Pick<ChannelView, "status" | "build">): AppHome {
  if (channel.status === "reauth_required") return "/reauth";
  return channel.build.state === "ready" ? "/app/audiences" : "/app/building";
}

/** The channel being looked at: the chosen one while the user still has it, else their first. */
export function pickChannel<T extends { id: string }>(
  channels: readonly T[],
  chosen: string | undefined,
): T | null {
  return channels.find((channel) => channel.id === chosen) ?? channels[0] ?? null;
}
