import { NotFoundError } from "@soundcheck/core";
import { getMe } from "@soundcheck/core/data";
import { meResponseSchema, type MeResponse } from "@soundcheck/core/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { GET } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({ getMe: vi.fn() }));

const session = (userId?: string) => ({ userId, channelIds: [], expires: "2099-01-01T00:00:00Z" });
// `auth` is overloaded; the route only uses the no-argument form.
const mockAuth = vi.mocked(auth as unknown as () => Promise<ReturnType<typeof session> | null>);

const me: MeResponse = {
  user: { id: "111111111111111111111", email: "creator@example.com" },
  channels: [
    {
      id: "UCaBcDeFgHiJkLmNoPqRsTuV",
      title: "Fixture Channel",
      thumbnailUrl: null,
      subscriberCount: 8450,
      videoCount: 64,
      status: "connected",
      connectedAt: "2026-10-06T10:00:00.000Z",
      build: { state: "not_started" },
    },
  ],
};

describe("GET /api/v1/me", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    expect(getMe).not.toHaveBeenCalled();
  });

  it("returns 401 for a session without a user ID", async () => {
    mockAuth.mockResolvedValue(session());
    expect((await GET()).status).toBe(401);
  });

  it("returns the user and channels for the session's user only", async () => {
    mockAuth.mockResolvedValue(session("111111111111111111111"));
    vi.mocked(getMe).mockResolvedValue(me);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(meResponseSchema.parse(await response.json())).toEqual(me);
    expect(getMe).toHaveBeenCalledWith("111111111111111111111");
  });

  it("returns 404 when the user document is gone", async () => {
    mockAuth.mockResolvedValue(session("111111111111111111111"));
    vi.mocked(getMe).mockRejectedValue(new NotFoundError("user"));
    expect((await GET()).status).toBe(404);
  });
});
