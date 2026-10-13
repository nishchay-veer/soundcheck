import { getSoundcheck } from "@soundcheck/core/data";
import { NO_STORE, respondForUser } from "@/lib/respond";

export const runtime = "nodejs";

/** One soundcheck, as its page polls it while the job runs: never cached. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; soundcheckId: string }> },
): Promise<Response> {
  const { id, soundcheckId } = await params;
  return respondForUser((userId) => getSoundcheck(userId, id, soundcheckId), NO_STORE);
}
