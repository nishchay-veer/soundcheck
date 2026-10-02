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
      versions: { extraction: "beats-v1", feature: "feat-v1", model: "hazard-v1" },
    });
  });
});
