import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { encryptRefreshToken } from "../crypto/tokens";
import { resetEnvCache } from "../env";
import { NotFoundError } from "../errors";
import { FakeBigQuery } from "../fake-bigquery";
import { FakeFirestore } from "../fake-firestore";
import { FakeKms } from "../fake-kms";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import type { ChannelDoc } from "../schemas";
import { memoryLogger } from "../test-utils";
import { deleteChannel } from "./delete-channel";

const OWNER = "111111111111111111111";
const STRANGER = "222222222222222222222";
const MINE = "UCaBcDeFgHiJkLmNoPqRsTuV";
const OTHER = "UCzYxWvUtSrQpOnMlKjIhGfE";
const REFRESH_TOKEN = "1//fixture-refresh-token";
const quiet = createLogger({ level: "silent" });

describe("deleteChannel", () => {
  let db: FakeFirestore;
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;
  let revoke: MockInstance<typeof fetch>;

  beforeEach(async () => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv(
      "KMS_KEY_NAME",
      "projects/p/locations/us-central1/keyRings/soundcheck/cryptoKeys/oauth-tokens",
    );
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    vi.stubEnv("GCS_UPLOADS_BUCKET", "test-uploads");
    vi.stubEnv("GCS_MEDIA_BUCKET", "test-media");

    db = new FakeFirestore();
    const kms = new FakeKms();
    bigquery = new FakeBigQuery({
      videos: [
        { channel_id: MINE, video_id: "a" },
        { channel_id: MINE, video_id: "b" },
        { channel_id: OTHER, video_id: "c" },
      ],
      beats: [{ channel_id: MINE, video_id: "a" }],
      model_runs: [{ channel_id: OTHER, run_id: "r" }],
    });
    storage = new FakeStorage({
      "test-raw": new Set([
        `${MINE}/channels/v1/20261006.json`,
        `${MINE}/analytics/a/20261006.json`,
        `${OTHER}/channels/x.json`,
      ]),
      "test-uploads": new Set([`${MINE}/cut.mp4`]),
      "test-media": new Set([`${OTHER}/thumb.png`]),
    });
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("kms", kms.asKms());
    setClientOverride("bigquery", bigquery.asBigQuery());
    setClientOverride("storage", storage.asStorage());
    revoke = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

    const channel = (userId: string): ChannelDoc => ({
      userId,
      title: "Fixture Channel",
      thumbnailUrl: null,
      subscriberCount: 1,
      videoCount: 2,
      uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
      status: "connected",
      tokenCiphertext: "",
      tokenScope: "openid",
      connectedAt: new Date("2026-10-06T10:00:00Z"),
      build: { state: "ready" },
    });
    await db
      .collection("channels")
      .doc(MINE)
      .set({
        ...channel(OWNER),
        tokenCiphertext: await encryptRefreshToken(OWNER, REFRESH_TOKEN),
      });
    await db
      .collection("channels")
      .doc(MINE)
      .collection("screens")
      .doc("audiences")
      .set({ any: 1 });
    await db
      .collection("channels")
      .doc(OTHER)
      .set({ ...channel(STRANGER), tokenCiphertext: "eA==" });
    await db
      .collection("users")
      .doc(OWNER)
      .set({
        email: "creator@example.com",
        channelIds: [MINE],
        createdAt: new Date("2026-10-06T10:00:00Z"),
        lastSignInAt: new Date("2026-10-06T10:00:00Z"),
      });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("removes every trace of the channel and nothing else", async () => {
    const result = await deleteChannel(OWNER, MINE, quiet);

    expect(result).toEqual({
      channelId: MINE,
      tokenRevoked: true,
      bigqueryRowsDeleted: { beats: 1, model_runs: 0, videos: 2 },
      storageObjectsDeleted: { "test-raw": 2, "test-uploads": 1, "test-media": 0 },
    });
    // Firestore: the channel and everything under it are gone; others remain.
    expect([...db.docs.keys()].filter((path) => path.includes(MINE))).toEqual([]);
    expect(db.docs.has(`channels/${OTHER}`)).toBe(true);
    expect(db.docs.get(`users/${OWNER}`)?.channelIds).toEqual([]);
    // BigQuery and GCS: only the other channel's data is left.
    expect(
      Object.values(bigquery.tables)
        .flat()
        .map((row) => row.channel_id),
    ).toEqual([OTHER, OTHER]);
    expect([...storage.buckets["test-raw"]!]).toEqual([`${OTHER}/channels/x.json`]);
    expect(storage.buckets["test-uploads"]!.size).toBe(0);
    expect([...storage.buckets["test-media"]!]).toEqual([`${OTHER}/thumb.png`]);
  });

  it("revokes the decrypted refresh token at Google", async () => {
    await deleteChannel(OWNER, MINE, quiet);
    const [url, init] = revoke.mock.calls[0] ?? [];
    expect(url).toBe("https://oauth2.googleapis.com/revoke");
    expect(String(init?.body)).toBe(`token=${encodeURIComponent(REFRESH_TOKEN)}`);
  });

  it("passes the channel ID to BigQuery as a parameter, not in the SQL", async () => {
    await deleteChannel(OWNER, MINE, quiet);
    const deletes = bigquery.queries.filter((q) => q.query.startsWith("DELETE"));
    expect(deletes).toHaveLength(3);
    for (const { query, params, location } of deletes) {
      expect(query).not.toContain(MINE);
      expect(params).toEqual({ channelId: MINE });
      expect(location).toBe("US");
    }
  });

  it("still deletes when Google already considers the token invalid", async () => {
    revoke.mockResolvedValue(new Response('{"error":"invalid_token"}', { status: 400 }));
    const result = await deleteChannel(OWNER, MINE, quiet);
    expect(result.tokenRevoked).toBe(false);
    expect(db.docs.has(`channels/${MINE}`)).toBe(false);
  });

  it("refuses another user's channel and deletes nothing", async () => {
    await expect(deleteChannel(STRANGER, MINE, quiet)).rejects.toThrow(NotFoundError);
    expect(revoke).not.toHaveBeenCalled();
    expect(bigquery.queries).toHaveLength(0);
    expect(db.docs.has(`channels/${MINE}`)).toBe(true);
  });

  it("keeps the channel in Firestore when BigQuery fails, so the delete can be retried", async () => {
    bigquery.failDeletes = new Error(
      "UPDATE or DELETE statement over table would affect rows in the streaming buffer",
    );
    await expect(deleteChannel(OWNER, MINE, quiet)).rejects.toThrow(/streaming buffer/);
    expect(db.docs.has(`channels/${MINE}`)).toBe(true);
    expect(db.docs.get(`users/${OWNER}`)?.channelIds).toEqual([MINE]);
  });

  it("logs a summary without the token", async () => {
    const { lines, logger } = memoryLogger();
    await deleteChannel(OWNER, MINE, logger);
    const output = JSON.stringify(lines);
    expect(output).toContain("channel deleted");
    expect(output).not.toContain(REFRESH_TOKEN);
  });
});
