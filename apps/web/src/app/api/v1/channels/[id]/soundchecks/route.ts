import {
  FixturesModeError,
  NotBuiltError,
  NotFoundError,
  SoundcheckNotConfiguredError,
  SoundcheckRejectedError,
} from "@soundcheck/core";
import { createSoundcheck } from "@soundcheck/core/data";
import { soundcheckCreateSchema, soundcheckCreatedSchema } from "@soundcheck/core/schemas";
import { NO_STORE } from "@/lib/respond";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/** Each refusal of the request itself, with its status. */
const REJECTED_STATUS = { unsupported_type: 415, too_large: 413, invalid_link: 400 } as const;

/**
 * Starts a soundcheck of one of the user's channels (201): a file gets an
 * upload session for the browser, a link is queued and its workflow started.
 * Someone else's channel is a 404; a channel with no published build a 409;
 * a file of another type 415, over 2 GB 413, a link that is not a YouTube
 * video 400; an environment without the workflow (or in fixtures mode) 503.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const parsed = soundcheckCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request" }, { status: 400, headers: NO_STORE });
  }
  // Cloud Storage lets the browser send chunks only from the origin that opened the session.
  const origin = request.headers.get("origin") ?? new URL(request.url).origin;
  try {
    const created = await createSoundcheck(userId, id, parsed.data, { origin });
    return Response.json(soundcheckCreatedSchema.parse(created), {
      status: 201,
      headers: NO_STORE,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404, headers: NO_STORE });
    }
    if (error instanceof SoundcheckRejectedError) {
      return Response.json(
        { error: error.code, message: error.message },
        { status: REJECTED_STATUS[error.code], headers: NO_STORE },
      );
    }
    if (error instanceof NotBuiltError) {
      return Response.json({ error: "not_built" }, { status: 409, headers: NO_STORE });
    }
    if (error instanceof SoundcheckNotConfiguredError) {
      return Response.json(
        { error: "soundchecks_not_configured" },
        { status: 503, headers: NO_STORE },
      );
    }
    if (error instanceof FixturesModeError) {
      return Response.json({ error: "fixtures_mode" }, { status: 503, headers: NO_STORE });
    }
    throw error;
  }
}
