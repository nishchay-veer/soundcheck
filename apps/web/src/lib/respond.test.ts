import { NotFoundError, resetEnvCache } from "@soundcheck/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { respondForUser } from "./respond";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
const mockAuth = vi.mocked(auth as unknown as () => Promise<{ userId?: string } | null>);
const USER = "111111111111111111111";

describe("respondForUser", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("answers 401 without a session, without loading anything", async () => {
    mockAuth.mockResolvedValue(null);
    const load = vi.fn();
    expect((await respondForUser(load)).status).toBe(401);
    expect(load).not.toHaveBeenCalled();
  });

  it("returns the document for the signed-in user, cacheable for 30 s in the browser only", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    const load = vi.fn(async () => ({ headline: "A headline." }));
    const response = await respondForUser(load);
    expect(load).toHaveBeenCalledWith(USER);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=30");
    expect(await response.json()).toEqual({ headline: "A headline." });
  });

  it("tells a missing or foreign resource from one not published yet, and caches neither", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    const missing = await respondForUser(async () => {
      throw new NotFoundError("channel");
    });
    expect([missing.status, await missing.json()]).toEqual([404, { error: "not_found" }]);
    const unpublished = await respondForUser(async () => null);
    expect([unpublished.status, await unpublished.json()]).toEqual([
      404,
      { error: "not_published" },
    ]);
    expect(unpublished.headers.get("cache-control")).toBe("no-store");
  });

  it("acts as the fixture user in fixtures mode, without asking Auth.js", async () => {
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "true");
    resetEnvCache();
    const load = vi.fn(async () => ({}));
    await respondForUser(load);
    expect(load).toHaveBeenCalledWith("fixture-user");
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
