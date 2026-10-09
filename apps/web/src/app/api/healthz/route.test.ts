import { EXTRACTION_VERSION, FEATURE_VERSION, MODEL_VERSION } from "@soundcheck/core";
import { healthzResponseSchema } from "@soundcheck/core/schemas";
import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/healthz", () => {
  it("returns ok with the pipeline versions", async () => {
    const response = GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = healthzResponseSchema.parse(await response.json());
    expect(body).toEqual({
      status: "ok",
      versions: { extraction: EXTRACTION_VERSION, feature: FEATURE_VERSION, model: MODEL_VERSION },
    });
  });
});
