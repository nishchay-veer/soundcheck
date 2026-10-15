import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NotFoundError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { resetClients, setClientOverride } from "../gcp";
import { channelViewSchema, type ChannelDoc } from "../schemas";
import { getMe, getUserChannelIds, toChannelView } from "./users";

const ME = "111111111111111111111";
const OTHER = "222222222222222222222";
const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const THEIRS = "UCzYxWvUtSrQpOnMlKjIhGfE";

const channel = (userId: string, title: string): ChannelDoc => ({
  userId,
  title,
  thumbnailUrl: "https://yt3.ggpht.com/fixture=s800",
  subscriberCount: null,
  videoCount: 64,
  uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
  status: "connected",
  tokenCiphertext: "c2VjcmV0LWNpcGhlcnRleHQ=",
  tokenScope: "openid email profile",
  connectedAt: new Date("2026-10-06T10:00:00Z"),
  build: { state: "not_started" },
});

describe("users", () => {
  let db: FakeFirestore;

  beforeEach(async () => {
    db = new FakeFirestore();
    setClientOverride("firestore", db.asFirestore());
    await db.collection("channels").doc(MINE).set(channel(ME, "Mine"));
    await db.collection("channels").doc(THEIRS).set(channel(OTHER, "Theirs"));
    await db
      .collection("users")
      .doc(ME)
      .set({
        email: "creator@example.com",
        // THEIRS is a stale or tampered entry; it must not be returned.
        channelIds: [MINE, THEIRS],
        createdAt: new Date("2026-10-06T10:00:00Z"),
        lastSignInAt: new Date("2026-10-06T10:00:00Z"),
      });
  });

  afterEach(() => {
    resetClients();
  });

  it("returns the user and only the channels they own, without token fields", async () => {
    const me = await getMe(ME);

    expect(me).toEqual({
      user: { id: ME, email: "creator@example.com" },
      channels: [
        {
          id: MINE,
          title: "Mine",
          thumbnailUrl: "https://yt3.ggpht.com/fixture=s800",
          subscriberCount: null,
          videoCount: 64,
          status: "connected",
          connectedAt: "2026-10-06T10:00:00.000Z",
          build: { state: "not_started" },
        },
      ],
    });
    expect(JSON.stringify(me)).not.toMatch(/tokenCiphertext|tokenScope|c2VjcmV0/);
  });

  it("shows a running build with ISO dates and without its execution path", () => {
    const view = toChannelView({
      id: MINE,
      ...channel(ME, "Mine"),
      build: {
        state: "running",
        runId: "d81fba4cba194878a25705b6d33d9e5f",
        mode: "build",
        stage: "extract",
        stageStartedAt: new Date("2026-10-10T16:01:30Z"),
        stageAttempt: 2,
        startedAt: new Date("2026-10-10T15:59:08Z"),
        execution: "projects/p/locations/us-central1/workflows/channel_build/executions/e",
        usableVideos: 3,
        progress: {
          stage: "extract",
          done: 2,
          total: 3,
          etaS: 12,
          updatedAt: new Date("2026-10-10T16:02:00Z"),
        },
      },
    });
    expect(channelViewSchema.parse(view).build).toEqual({
      state: "running",
      runId: "d81fba4cba194878a25705b6d33d9e5f",
      mode: "build",
      stage: "extract",
      stageStartedAt: "2026-10-10T16:01:30.000Z",
      stageAttempt: 2,
      startedAt: "2026-10-10T15:59:08.000Z",
      usableVideos: 3,
      progress: {
        stage: "extract",
        done: 2,
        total: 3,
        etaS: 12,
        updatedAt: "2026-10-10T16:02:00.000Z",
      },
    });
    expect(JSON.stringify(view)).not.toMatch(/execution|tokenCiphertext|tokenScope/);
  });

  it("throws NotFoundError for a user without a document", async () => {
    await expect(getMe(OTHER)).rejects.toThrow(NotFoundError);
  });

  it("lists channel IDs, or none for a new user", async () => {
    await expect(getUserChannelIds(ME)).resolves.toEqual([MINE, THEIRS]);
    await expect(getUserChannelIds(OTHER)).resolves.toEqual([]);
  });
});
