import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import type { HealthzResponse } from "@soundcheck/core/schemas";

export function GET(): Response {
  const body: HealthzResponse = {
    status: "ok",
    versions: { extraction: EXTRACTION_VERSION, feature: FEATURE_VERSION, model: MODEL_VERSION },
  };
  return Response.json(body, { headers: { "cache-control": "no-store" } });
}
