import { NotFoundError } from "@soundcheck/core";
import { deleteChannel } from "@soundcheck/core/data";
import type { ChannelDeletion } from "@soundcheck/core/schemas";
import { auth } from "@/auth";

export const runtime = "nodejs";

/**
 * Disconnects a channel and deletes every trace of it: revokes the token and
 * removes its Firestore documents, BigQuery rows and Cloud Storage objects.
 * Someone else's channel is a 404, the same as a missing one. The session
 * cookie is SameSite=Lax, so other sites cannot trigger this.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const session = await auth();
  if (!session?.userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    const body: ChannelDeletion = await deleteChannel(session.userId, id);
    return Response.json(body, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof NotFoundError)
      return Response.json({ error: "not_found" }, { status: 404 });
    throw error;
  }
}
