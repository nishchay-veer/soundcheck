import { NotFoundError } from "@soundcheck/core";
import { deleteChannel } from "@soundcheck/core/data";
import { channelDeletionSchema, type ChannelDeletion } from "@soundcheck/core/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { DELETE } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({ deleteChannel: vi.fn() }));

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const mockAuth = vi.mocked(auth as unknown as () => Promise<{ userId?: string } | null>);
const call = (id = CHANNEL_ID) =>
  DELETE(new Request(`http://localhost:3000/api/v1/channels/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });

const deletion: ChannelDeletion = {
  channelId: CHANNEL_ID,
  tokenRevoked: true,
  bigqueryRowsDeleted: { videos: 2 },
  storageObjectsDeleted: { "test-raw": 3 },
};

describe("DELETE /api/v1/channels/[id]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  it("deletes as the session's user and reports what was removed", async () => {
    mockAuth.mockResolvedValue({ userId: "111111111111111111111" });
    vi.mocked(deleteChannel).mockResolvedValue(deletion);

    const response = await call();

    expect(response.status).toBe(200);
    expect(channelDeletionSchema.parse(await response.json())).toEqual(deletion);
    expect(deleteChannel).toHaveBeenCalledWith("111111111111111111111", CHANNEL_ID);
  });

  it("returns 404 for a channel the user does not own", async () => {
    mockAuth.mockResolvedValue({ userId: "222222222222222222222" });
    vi.mocked(deleteChannel).mockRejectedValue(new NotFoundError("channel"));
    expect((await call()).status).toBe(404);
  });
});
