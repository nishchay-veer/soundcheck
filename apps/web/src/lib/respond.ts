import { NotFoundError } from "@soundcheck/core";
import { currentUserId } from "./session";

/** Published documents change only when a build publishes, so a browser may reuse them briefly. */
export const DOCUMENT_CACHE = { "cache-control": "private, max-age=30" };
/** Live state (the build's progress) and missing documents are never cached. */
export const NO_STORE = { "cache-control": "no-store" };

/**
 * Answers a GET with what `load` returns for the signed-in user: 401 without
 * one, 404 `not_found` for a NotFoundError (a missing channel and someone
 * else's look the same), and 404 `not_published` when `load` returns null
 * because no build has published the document yet.
 */
export async function respondForUser<T>(
  load: (userId: string) => Promise<T | null>,
  headers: Record<string, string> = DOCUMENT_CACHE,
): Promise<Response> {
  const userId = await currentUserId();
  // The proxy already rejects anonymous calls; this guards direct invocation.
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  try {
    const body = await load(userId);
    if (body === null) {
      return Response.json({ error: "not_published" }, { status: 404, headers: NO_STORE });
    }
    return Response.json(body, { headers });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    throw error;
  }
}
