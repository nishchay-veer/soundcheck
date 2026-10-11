import { listVideos } from "@soundcheck/core/data";
import { respondForUser } from "@/lib/respond";

export const runtime = "nodejs";

/** Every published video of the channel, for the list screen. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return respondForUser((userId) => listVideos(userId, id));
}
