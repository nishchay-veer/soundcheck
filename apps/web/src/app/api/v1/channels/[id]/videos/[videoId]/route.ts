import { getVideo } from "@soundcheck/core/data";
import { respondForUser } from "@/lib/respond";

export const runtime = "nodejs";

/** One video's screen: curves, beats and drop-offs. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; videoId: string }> },
): Promise<Response> {
  const { id, videoId } = await params;
  return respondForUser((userId) => getVideo(userId, id, videoId));
}
