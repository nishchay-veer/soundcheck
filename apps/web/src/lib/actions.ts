"use server";

import { getMe } from "@soundcheck/core/data";
import { isProduction } from "@soundcheck/core/env";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { CHANNEL_COOKIE } from "./channel";
import { currentUserId } from "./session";

/** Switches the channel being looked at, to one the user owns, then reopens the app. */
export async function chooseChannel(form: FormData): Promise<void> {
  const userId = await currentUserId();
  if (!userId) redirect("/");
  const id = String(form.get("channel") ?? "");
  const { channels } = await getMe(userId);
  if (channels.some((channel) => channel.id === id)) {
    (await cookies()).set(CHANNEL_COOKIE, id, {
      httpOnly: true,
      sameSite: "lax",
      secure: isProduction(),
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
  }
  redirect("/app");
}
