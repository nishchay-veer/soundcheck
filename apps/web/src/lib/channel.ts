import { getMe } from "@soundcheck/core/data";
import type { ChannelView, MeResponse } from "@soundcheck/core/schemas";
import { cookies } from "next/headers";
import { pickChannel } from "./app-home";

/** The channel a user with several is looking at; set by `chooseChannel`. */
export const CHANNEL_COOKIE = "soundcheck-channel";

/** The signed-in user, their channels, and the one being looked at (null without any). */
export async function currentChannel(
  userId: string,
): Promise<{ me: MeResponse; channel: ChannelView | null }> {
  const [me, store] = await Promise.all([getMe(userId), cookies()]);
  return { me, channel: pickChannel(me.channels, store.get(CHANNEL_COOKIE)?.value) };
}
