import { getMe } from "@soundcheck/core/data";
import { NO_STORE, respondForUser } from "@/lib/respond";

export const runtime = "nodejs";

/** The signed-in user and their channels, with each build's live state. */
export async function GET(): Promise<Response> {
  return respondForUser(getMe, NO_STORE);
}
