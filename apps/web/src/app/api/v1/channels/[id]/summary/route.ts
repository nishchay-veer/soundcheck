import { getSummary } from "@soundcheck/core/data";
import { respondForUser } from "@/lib/respond";

export const runtime = "nodejs";

/** The channel overview: headline, audience cards and the evaluation. */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return respondForUser((userId) => getSummary(userId, id));
}
