import { OAuth2Client } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { encryptRefreshToken } from "../crypto/tokens";
import { resetEnvCache } from "../env";
import { NotFoundError, ReauthRequiredError } from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { FakeKms } from "../fake-kms";
import { FakeSecretManager } from "../fake-secret-manager";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import type { ChannelDoc } from "../schemas";
import { resetSecretCache } from "../secrets";
import { credentialsForChannel } from "./auth";

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OWNER = "111111111111111111111";
const REFRESH_TOKEN = "1//fixture-refresh-token";
const quiet = createLogger({ level: "silent" });

/** getAccessToken is overloaded; spy on its promise form. */
const spyOnRefresh = (): MockInstance<() => Promise<{ token: string | null }>> =>
  vi.spyOn(OAuth2Client.prototype, "getAccessToken") as unknown as MockInstance<
    () => Promise<{ token: string | null }>
  >;

const invalidGrant = () =>
  Object.assign(new Error("invalid_grant"), {
    response: {
      status: 400,
      data: { error: "invalid_grant", error_description: "Token has been expired or revoked." },
    },
  });

describe("credentialsForChannel", () => {
  let db: FakeFirestore;
  let kms: FakeKms;
  let secrets: FakeSecretManager;

  const storeChannel = async (overrides: Partial<ChannelDoc> = {}) => {
    const channel: ChannelDoc = {
      userId: OWNER,
      title: "Fixture Channel",
      thumbnailUrl: null,
      subscriberCount: 8450,
      videoCount: 64,
      uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
      status: "connected",
      tokenCiphertext: await encryptRefreshToken(OWNER, REFRESH_TOKEN),
      tokenScope: "openid",
      connectedAt: new Date("2026-10-06T10:00:00Z"),
      build: { state: "not_started" },
      ...overrides,
    };
    await db.collection("channels").doc(CHANNEL_ID).set(channel);
  };
  const status = async () => (await db.collection("channels").doc(CHANNEL_ID).get()).data()?.status;

  beforeEach(() => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv(
      "KMS_KEY_NAME",
      "projects/p/locations/us-central1/keyRings/soundcheck/cryptoKeys/oauth-tokens",
    );
    db = new FakeFirestore();
    kms = new FakeKms();
    secrets = new FakeSecretManager({
      "oauth-client-id": "client-id.apps.googleusercontent.com",
      "oauth-client-secret": "client-secret-value",
    });
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("kms", kms.asKms());
    setClientOverride("secretManager", secrets.asSecretManager());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetClients();
    resetSecretCache();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns a client holding the decrypted refresh token and a fresh access token", async () => {
    await storeChannel();
    const refresh = spyOnRefresh().mockResolvedValue({ token: "ya29.fresh" });

    const client = await credentialsForChannel(CHANNEL_ID, quiet);

    expect(client.credentials.refresh_token).toBe(REFRESH_TOKEN);
    expect(client._clientId).toBe("client-id.apps.googleusercontent.com");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(kms.calls.at(-1)).toMatchObject({ method: "decrypt", aad: OWNER });
    expect(secrets.reads).toEqual([
      "projects/soundcheck-test/secrets/oauth-client-id/versions/latest",
      "projects/soundcheck-test/secrets/oauth-client-secret/versions/latest",
    ]);
  });

  it("reads the OAuth client from Secret Manager once per process", async () => {
    await storeChannel();
    spyOnRefresh().mockResolvedValue({ token: "ya29.fresh" });
    await credentialsForChannel(CHANNEL_ID, quiet);
    await credentialsForChannel(CHANNEL_ID, quiet);
    expect(secrets.reads).toHaveLength(2);
  });

  it("marks the channel reauth_required when Google rejects the token", async () => {
    await storeChannel();
    spyOnRefresh().mockRejectedValue(invalidGrant());

    await expect(credentialsForChannel(CHANNEL_ID, quiet)).rejects.toThrow(ReauthRequiredError);
    expect(await status()).toBe("reauth_required");
  });

  it("fails fast for a channel already waiting for reauth", async () => {
    await storeChannel({ status: "reauth_required" });
    const refresh = spyOnRefresh();
    const decryptsBefore = kms.calls.length;

    await expect(credentialsForChannel(CHANNEL_ID, quiet)).rejects.toThrow(ReauthRequiredError);
    expect(refresh).not.toHaveBeenCalled();
    expect(kms.calls).toHaveLength(decryptsBefore);
  });

  it("passes other OAuth errors through without changing the channel", async () => {
    await storeChannel();
    spyOnRefresh().mockRejectedValue(
      Object.assign(new Error("unauthorized_client"), {
        response: { status: 401, data: { error: "unauthorized_client" } },
      }),
    );

    await expect(credentialsForChannel(CHANNEL_ID, quiet)).rejects.toThrow("unauthorized_client");
    expect(await status()).toBe("connected");
  });

  it("throws NotFoundError for an unknown channel", async () => {
    await expect(credentialsForChannel(CHANNEL_ID, quiet)).rejects.toThrow(NotFoundError);
  });
});
