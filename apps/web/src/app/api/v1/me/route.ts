import { NotFoundError } from "@soundcheck/core";
import { getMe } from "@soundcheck/core/data";
import type { MeResponse } from "@soundcheck/core/schemas";
import { auth } from "@/auth";

export const runtime = "nodejs";

/** The signed-in user and their channels. */
export async function GET(): Promise<Response> {
  const session = await auth();
  // The proxy already rejects anonymous calls; this guards direct invocation.
  if (!session?.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body: MeResponse = await getMe(session.userId);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError)
      return Response.json({ error: "not_found" }, { status: 404 });
    throw error;
  }
}
