import { FixturesModeError, NotFoundError } from "@soundcheck/core";
import { deleteChannel, getChannel } from "@soundcheck/core/data";
import type { ChannelDeletion } from "@soundcheck/core/schemas";
import { NO_STORE, respondForUser } from "@/lib/respond";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/** The channel with its build's live state and progress; never cached. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return respondForUser((userId) => getChannel(userId, id), NO_STORE);
}

/**
 * Disconnects a channel and deletes every trace of it: revokes the token and
 * removes its Firestore documents, BigQuery rows and Cloud Storage objects.
 * Someone else's channel is a 404, the same as a missing one. The session
 * cookie is SameSite=Lax, so other sites cannot trigger this. Fixtures mode
 * never deletes anything (503).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body: ChannelDeletion = await deleteChannel(userId, id);
    return Response.json(body, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof NotFoundError)
      return Response.json({ error: "not_found" }, { status: 404 });
    if (error instanceof FixturesModeError)
      return Response.json({ error: "fixtures_mode" }, { status: 503, headers: NO_STORE });
    throw error;
  }
}
