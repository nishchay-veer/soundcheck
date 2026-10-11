import {
  BuildInProgressError,
  BuildNotConfiguredError,
  FixturesModeError,
  NotFoundError,
} from "@soundcheck/core";
import { requireChannel, startChannelBuild } from "@soundcheck/core/data";
import { buildStartSchema } from "@soundcheck/core/schemas";
import { currentUserId } from "@/lib/session";

export const runtime = "nodejs";

/**
 * Starts a build of one of the user's channels: the `channel_build` workflow
 * runs every stage in Cloud Run jobs, so this only queues it (202). Someone
 * else's channel is a 404, a build already queued or running a 409, and an
 * environment without the workflow (or in fixtures mode) a 503.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const userId = await currentUserId();
  if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const headers = { "cache-control": "no-store" };
  try {
    await requireChannel(userId, id);
    const started = await startChannelBuild(id);
    const body = buildStartSchema.parse({
      channelId: started.channelId,
      runId: started.runId,
      mode: started.mode,
      state: "queued",
    });
    return Response.json(body, { status: 202, headers });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return Response.json({ error: "not_found" }, { status: 404, headers });
    }
    if (error instanceof BuildInProgressError) {
      return Response.json(
        { error: "build_in_progress", state: error.state },
        { status: 409, headers },
      );
    }
    if (error instanceof BuildNotConfiguredError) {
      return Response.json({ error: "builds_not_configured" }, { status: 503, headers });
    }
    if (error instanceof FixturesModeError) {
      return Response.json({ error: "fixtures_mode" }, { status: 503, headers });
    }
    throw error;
  }
}
