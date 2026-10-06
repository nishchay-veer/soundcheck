import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { ChannelOwnedError, MissingScopesError, NoChannelError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { FakeKms } from "../fake-kms";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { YOUTUBE_SCOPES, channelDocSchema, userDocSchema } from "../schemas";
import { memoryLogger } from "../test-utils";
import { listMyChannels } from "../youtube/client";
import { connectChannel, type ConnectChannelInput } from "./channels";

vi.mock("../youtube/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../youtube/client")>()),
  listMyChannels: vi.fn(),
}));

const fixture: unknown = JSON.parse(
  readFileSync(
    new URL("../../../../tests/fixtures/youtube/channels.list.mine.json", import.meta.url),
    "utf8",
  ),
);

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const ACCESS_TOKEN = "ya29.fixture-access-token";
const REFRESH_TOKEN = "1//fixture-refresh-token";
const ALL_SCOPES = ["openid", "email", "profile", ...YOUTUBE_SCOPES].join(" ");

const input = (overrides: Partial<ConnectChannelInput> = {}): ConnectChannelInput => ({
  googleSub: "111111111111111111111",
  email: "creator@example.com",
  accessToken: ACCESS_TOKEN,
  refreshToken: REFRESH_TOKEN,
  expiresAt: 1_790_000_000,
  scope: ALL_SCOPES,
  ...overrides,
});

const quietLogger = () => createLogger({ level: "silent" });

describe("connectChannel", () => {
  let db: FakeFirestore;
  let kms: FakeKms;

  beforeEach(() => {
    vi.stubEnv(
      "KMS_KEY_NAME",
      "projects/p/locations/us-central1/keyRings/soundcheck/cryptoKeys/oauth-tokens",
    );
    db = new FakeFirestore();
    kms = new FakeKms();
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("kms", kms.asKms());
    vi.mocked(listMyChannels).mockResolvedValue(fixture);
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
    vi.mocked(listMyChannels).mockReset();
  });

  const channelDoc = async () =>
    channelDocSchema.parse((await db.collection("channels").doc(CHANNEL_ID).get()).data());
  const userDoc = async () =>
    userDocSchema.parse((await db.collection("users").doc("111111111111111111111").get()).data());

  it.each([
    ["youtube.readonly", YOUTUBE_SCOPES[0]],
    ["yt-analytics.readonly", YOUTUBE_SCOPES[1]],
  ])("rejects a sign-in without %s before calling any API", async (_, dropped) => {
    const scope = ALL_SCOPES.split(" ")
      .filter((s) => s !== dropped)
      .join(" ");
    const attempt = connectChannel(input({ scope }), quietLogger());
    await expect(attempt).rejects.toThrow(MissingScopesError);
    await expect(attempt).rejects.toMatchObject({ missing: [dropped] });
    expect(listMyChannels).not.toHaveBeenCalled();
    expect(kms.calls).toHaveLength(0);
    expect(db.docs.size).toBe(0);
  });

  it("creates the channel and user with an encrypted token", async () => {
    const result = await connectChannel(input(), quietLogger());

    expect(result).toEqual({
      userId: "111111111111111111111",
      channelId: CHANNEL_ID,
      created: true,
    });
    expect(await channelDoc()).toMatchObject({
      userId: "111111111111111111111",
      title: "Fixture Channel",
      thumbnailUrl: "https://yt3.ggpht.com/fixture",
      subscriberCount: 8450,
      videoCount: 64,
      uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
      status: "connected",
      tokenScope: ALL_SCOPES,
      build: { state: "not_started" },
    });
    expect(await userDoc()).toMatchObject({
      email: "creator@example.com",
      channelIds: [CHANNEL_ID],
    });
    expect(kms.calls).toEqual([
      expect.objectContaining({ method: "encrypt", aad: "111111111111111111111" }),
    ]);
  });

  it("stores no plaintext token anywhere", async () => {
    await connectChannel(input(), quietLogger());
    const stored = JSON.stringify([...db.docs]);
    expect(stored).not.toContain(REFRESH_TOKEN);
    expect(stored).not.toContain(ACCESS_TOKEN);
  });

  it("refreshes a reconnection without resetting its build", async () => {
    await connectChannel(input(), quietLogger());
    const first = await channelDoc();
    await db
      .collection("channels")
      .doc(CHANNEL_ID)
      .set({ status: "reauth_required", build: { state: "succeeded" } }, { merge: true });

    const result = await connectChannel(input({ refreshToken: "1//a-newer-token" }), quietLogger());

    const second = await channelDoc();
    expect(result.created).toBe(false);
    expect(second.status).toBe("connected");
    expect(second.build).toEqual({ state: "succeeded" });
    expect(second.connectedAt).toEqual(first.connectedAt);
    expect(second.tokenCiphertext).not.toBe(first.tokenCiphertext);
    expect((await userDoc()).channelIds).toEqual([CHANNEL_ID]);
  });

  it("refuses a channel connected by another user and leaves it untouched", async () => {
    await connectChannel(input(), quietLogger());
    const before = await channelDoc();

    await expect(
      connectChannel(input({ googleSub: "222222222222222222222" }), quietLogger()),
    ).rejects.toThrow(ChannelOwnedError);
    expect(await channelDoc()).toEqual(before);
    expect(db.docs.has("users/222222222222222222222")).toBe(false);
  });

  it("throws NoChannelError for an account without a channel", async () => {
    vi.mocked(listMyChannels).mockResolvedValue({ kind: "youtube#channelListResponse", items: [] });
    await expect(connectChannel(input(), quietLogger())).rejects.toThrow(NoChannelError);
    expect(kms.calls).toHaveLength(0);
  });

  it("requires a refresh token", async () => {
    await expect(connectChannel(input({ refreshToken: undefined }), quietLogger())).rejects.toThrow(
      /no refresh token/,
    );
  });

  it("never writes a token to the logs", async () => {
    const { lines, logger } = memoryLogger();
    await connectChannel(input(), logger);
    // What a careless log line around sign-in would contain: Auth.js's account
    // object and this function's input.
    logger.info(
      {
        account: {
          access_token: ACCESS_TOKEN,
          refresh_token: REFRESH_TOKEN,
          id_token: "eyJ.fixture.id",
        },
        input: input(),
      },
      "sign-in",
    );

    const output = JSON.stringify(lines);
    expect(output).toContain("channel connected");
    expect(output).toContain(CHANNEL_ID);
    for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "eyJ.fixture.id"]) {
      expect(output).not.toContain(secret);
    }
  });
});
