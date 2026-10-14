import { InvalidEditsError, NotFoundError, SoundcheckNotReadyError } from "@soundcheck/core";
import { simulateSoundcheck } from "@soundcheck/core/data";
import { simulateRequestSchema, simulationSchema } from "@soundcheck/core/schemas";
import { NO_STORE } from "@/lib/respond";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Simulates edits on one of the user's soundchecks, in this process from its
 * stored inputs and cached models (no Gemini, no BigQuery). Someone else's
 * soundcheck is a 404; one with no prediction yet a 409; edits that cannot go
 * together a 400. Works in fixtures mode, which only reads.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; soundcheckId: string }> },
): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, soundcheckId } = await params;
  const parsed = simulateRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  try {
    const simulation = await simulateSoundcheck(userId, id, soundcheckId, parsed.data);
    return Response.json(simulationSchema.parse(simulation), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    if (error instanceof InvalidEditsError) {
      return Response.json(
        { error: "invalid_edits", message: error.message },
        { status: 400, headers: NO_STORE },
      );
    }
    if (error instanceof SoundcheckNotReadyError) {
      return Response.json({ error: "not_ready" }, { status: 409, headers: NO_STORE });
    }
    throw error;
  }
}
