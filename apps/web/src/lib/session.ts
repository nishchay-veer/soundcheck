import { FIXTURE_USER_ID } from "@soundcheck/core/data";
import { fixturesMode } from "@soundcheck/core/env";
import { auth } from "@/auth";

/**
 * The signed-in user's ID, or null. In fixtures mode (development only) the
 * fixture user stands in, so screens can be built without Google sign-in.
 * Route handlers and server components use this, never `auth()` directly.
 */
export async function currentUserId(): Promise<string | null> {
  if (fixturesMode()) return FIXTURE_USER_ID;
  return (await auth())?.userId ?? null;
}
