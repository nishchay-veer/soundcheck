import { NextRequest, type NextFetchEvent } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// The real proxy and the real Auth.js session check; only the env is fake.
describe("proxy", () => {
  let proxy: (request: NextRequest, event: NextFetchEvent) => Promise<Response | undefined | null>;
  const event = { waitUntil: () => undefined } as unknown as NextFetchEvent;
  const call = (path: string, headers?: Record<string, string>) =>
    proxy(new NextRequest(`http://localhost:3000${path}`, { headers }), event);

  beforeAll(async () => {
    vi.stubEnv("AUTH_GOOGLE_ID", "test-client.apps.googleusercontent.com");
    vi.stubEnv("AUTH_GOOGLE_SECRET", "test-client-secret");
    vi.stubEnv("AUTH_SECRET", "test-auth-secret-that-is-long-enough-1234567890");
    vi.stubEnv("AUTH_URL", "http://localhost:3000");
    proxy = (await import("./proxy")).default as typeof proxy;
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("exports a function, as Next requires", async () => {
    expect(typeof (await import("./proxy")).default).toBe("function");
  });

  it("answers an anonymous API call with 401 JSON", async () => {
    const response = await call("/api/v1/me");
    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("rejects a forged session cookie", async () => {
    const response = await call("/api/v1/me", { cookie: "authjs.session-token=forged.jwt.value" });
    expect(response?.status).toBe(401);
  });

  it("redirects an anonymous page request to the home page", async () => {
    const response = await call("/app");
    expect(response?.status).toBe(307);
    expect(response?.headers.get("location")).toBe("http://localhost:3000/");
  });
});
