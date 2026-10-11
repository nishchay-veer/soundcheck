import {
  BuildInProgressError,
  BuildNotConfiguredError,
  FixturesModeError,
  NotFoundError,
} from "@soundcheck/core";
import { requireChannel, startChannelBuild } from "@soundcheck/core/data";
import { buildStartSchema, type Channel } from "@soundcheck/core/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({ requireChannel: vi.fn(), startChannelBuild: vi.fn() }));

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const USER = "111111111111111111111";
const mockAuth = vi.mocked(auth as unknown as () => Promise<{ userId?: string } | null>);
const call = (id = CHANNEL_ID) =>
  POST(new Request(`http://localhost:3000/api/v1/channels/${id}/build`, { method: "POST" }), {
    params: Promise.resolve({ id }),
  });

describe("POST /api/v1/channels/[id]/build", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(startChannelBuild).not.toHaveBeenCalled();
  });

  it("checks ownership, starts the build and answers 202 with the run", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(requireChannel).mockResolvedValue({ id: CHANNEL_ID } as Channel);
    vi.mocked(startChannelBuild).mockResolvedValue({
      channelId: CHANNEL_ID,
      runId: "run123",
      mode: "build",
      execution: "projects/p/locations/l/workflows/channel_build/executions/e1",
    });
    const response = await call();
    expect(response.status).toBe(202);
    expect(buildStartSchema.parse(await response.json())).toEqual({
      channelId: CHANNEL_ID,
      runId: "run123",
      mode: "build",
      state: "queued",
    });
    expect(requireChannel).toHaveBeenCalledWith(USER, CHANNEL_ID);
    expect(startChannelBuild).toHaveBeenCalledWith(CHANNEL_ID);
  });

  it("returns 404 for a channel the user does not own, without starting anything", async () => {
    mockAuth.mockResolvedValue({ userId: "222222222222222222222" });
    vi.mocked(requireChannel).mockRejectedValue(new NotFoundError("channel"));
    expect((await call()).status).toBe(404);
    expect(startChannelBuild).not.toHaveBeenCalled();
  });

  it("returns 409 while a build is running and 503 when builds are not configured", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(requireChannel).mockResolvedValue({ id: CHANNEL_ID } as Channel);
    vi.mocked(startChannelBuild).mockRejectedValueOnce(
      new BuildInProgressError(CHANNEL_ID, "running"),
    );
    const busy = await call();
    expect(busy.status).toBe(409);
    expect(await busy.json()).toEqual({ error: "build_in_progress", state: "running" });
    vi.mocked(startChannelBuild).mockRejectedValueOnce(new BuildNotConfiguredError());
    expect((await call()).status).toBe(503);
    vi.mocked(startChannelBuild).mockRejectedValueOnce(new FixturesModeError("starting a build"));
    const fixtures = await call();
    expect([fixtures.status, await fixtures.json()]).toEqual([503, { error: "fixtures_mode" }]);
  });
});
