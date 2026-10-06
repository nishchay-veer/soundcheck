import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotFoundError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { resetClients, setClientOverride } from "../gcp";
import type { ChannelDoc } from "../schemas";
import { requireChannel } from "./authz";

const OWNER = "111111111111111111111";
const CHANNEL_ID = "UCX6OQ3DkcsbYNE6H8uQQuVA";

const channel: ChannelDoc = {
  userId: OWNER,
  title: "Owner's channel",
  thumbnailUrl: "https://yt3.ggpht.com/example.jpg",
  subscriberCount: 1200,
  videoCount: 48,
  uploadsPlaylistId: "UUX6OQ3DkcsbYNE6H8uQQuVA",
  status: "connected",
  tokenCiphertext: "Y2lwaGVydGV4dA==",
  tokenScope: "openid",
  connectedAt: new Date("2026-10-06T10:00:00Z"),
  build: { state: "not_started" },
};

describe("requireChannel", () => {
  let db: FakeFirestore;

  beforeEach(async () => {
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
    await db.collection("channels").doc(CHANNEL_ID).set(channel);
  });

  afterEach(() => {
    resetClients();
  });

  it("returns the channel to its owner", async () => {
    await expect(requireChannel(OWNER, CHANNEL_ID)).resolves.toEqual({
      id: CHANNEL_ID,
      ...channel,
    });
  });

  it("hides another user's channel behind NotFoundError", async () => {
    await expect(requireChannel("222222222222222222222", CHANNEL_ID)).rejects.toThrow(
      NotFoundError,
    );
  });

  it("reports a missing channel the same way", async () => {
    await expect(requireChannel(OWNER, "UCaaaaaaaaaaaaaaaaaaaaaa")).rejects.toThrow(NotFoundError);
  });

  it.each(["not-a-channel", "UCX6OQ3DkcsbYNE6H8uQQuVA/tokens", "../users/x"])(
    "rejects the malformed ID %j without reading Firestore",
    async (badId) => {
      const read = vi.spyOn(db, "collection");
      await expect(requireChannel(OWNER, badId)).rejects.toThrow(NotFoundError);
      expect(read).not.toHaveBeenCalled();
    },
  );
});
