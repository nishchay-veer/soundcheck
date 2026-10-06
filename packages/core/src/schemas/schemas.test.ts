import { describe, expect, it } from "vitest";
import { channelDocSchema, channelIdSchema, firestoreDate } from "./index";

describe("channelIdSchema", () => {
  it.each(["UCX6OQ3DkcsbYNE6H8uQQuVA", "UC_x5XG1OV2P6uZZ5FSM9Ttw", "UC-lHJZR3Gqxm24_Vd_AJ5Yw"])(
    "accepts %s",
    (id) => {
      expect(channelIdSchema.safeParse(id).success).toBe(true);
    },
  );

  it.each([
    "",
    "UC123",
    "XX6OQ3DkcsbYNE6H8uQQuVAa",
    "UCX6OQ3DkcsbYNE6H8uQQuV/",
    "../users/someone",
  ])("rejects %j", (id) => {
    expect(channelIdSchema.safeParse(id).success).toBe(false);
  });
});

describe("firestoreDate", () => {
  it("normalizes a Firestore Timestamp to a Date", () => {
    const when = new Date("2026-10-06T10:00:00Z");
    expect(firestoreDate.parse({ toDate: () => when })).toEqual(when);
  });

  it("accepts a Date as is", () => {
    const when = new Date("2026-10-06T10:00:00Z");
    expect(firestoreDate.parse(when)).toEqual(when);
  });
});

describe("channelDocSchema", () => {
  it("accepts a hidden subscriber count and a missing thumbnail", () => {
    const parsed = channelDocSchema.parse({
      userId: "1234567890",
      title: "A channel",
      thumbnailUrl: null,
      subscriberCount: null,
      videoCount: 42,
      uploadsPlaylistId: "UUX6OQ3DkcsbYNE6H8uQQuVA",
      status: "connected",
      tokenCiphertext: "Y2lwaGVydGV4dA==",
      tokenScope: "openid",
      connectedAt: new Date(),
      build: { state: "not_started" },
    });
    expect(parsed.subscriberCount).toBeNull();
  });
});
