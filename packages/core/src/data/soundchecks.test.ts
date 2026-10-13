import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import {
  FixturesModeError,
  NotBuiltError,
  NotFoundError,
  SoundcheckNotConfiguredError,
  SoundcheckRejectedError,
} from "../errors";
import { FakeFirestore } from "../fake-firestore";
import { FakeExecutions } from "../fake-workflows";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import {
  UPLOAD_CHUNK_BYTES,
  servingPaths,
  soundcheckCreatedSchema,
  soundcheckDocSchema,
  soundcheckPaths,
  type ChannelDoc,
  type SoundcheckCreate,
} from "../schemas";
import {
  createSoundcheck,
  getSoundcheck,
  openUploadSession,
  soundcheckWorkflow,
  type UploadSessionRequest,
} from "./soundchecks";

const ME = "111111111111111111111";
const OTHER = "222222222222222222222";
const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const WORKFLOW = "projects/soundcheck-test/locations/us-central1/workflows/soundcheck";
const NOW = new Date("2026-10-13T09:00:00.000Z");
const ORIGIN = "http://localhost:3000";
const SESSION = "https://storage.googleapis.com/upload/storage/v1/b/test-uploads/o?upload_id=abc";
const quiet = createLogger({ level: "silent" });

const channel: ChannelDoc = {
  userId: ME,
  title: "A channel",
  thumbnailUrl: null,
  subscriberCount: 120,
  videoCount: 4,
  uploadsPlaylistId: "UUaBcDeFgHiJkLmNoPqRsTuV",
  status: "connected",
  tokenCiphertext: "c2VjcmV0",
  tokenScope: "openid",
  connectedAt: new Date("2026-10-06T10:00:00Z"),
  build: { state: "ready", runId: "run1", finishedAt: new Date("2026-10-10T16:21:45Z") },
};

const file = (
  overrides: Partial<Extract<SoundcheckCreate, { kind: "file" }>> = {},
): SoundcheckCreate => ({
  kind: "file",
  fileName: "rough cut v3.mov",
  contentType: "video/quicktime",
  sizeBytes: 900_000_000,
  title: "Building a guitar",
  scenario: "search",
  ...overrides,
});
const link = (value = "https://youtu.be/lgxOjPdCGkw?si=x"): SoundcheckCreate => ({
  kind: "youtube",
  link: value,
  title: "",
  scenario: "recent",
});

describe("soundchecks on the request path", () => {
  let db: FakeFirestore;
  let executions: FakeExecutions;
  let openUpload: ReturnType<typeof vi.fn<(request: UploadSessionRequest) => Promise<string>>>;
  const create = (request: SoundcheckCreate, userId = ME) =>
    createSoundcheck(userId, CHANNEL, request, {
      origin: ORIGIN,
      now: NOW,
      log: quiet,
      openUpload,
    });
  const stored = (id: string) =>
    soundcheckDocSchema.parse(db.docs.get(soundcheckPaths(CHANNEL).soundcheck(id)));

  beforeEach(async () => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    vi.stubEnv("GCP_REGION", "us-central1");
    vi.stubEnv("GCS_UPLOADS_BUCKET", "test-uploads");
    vi.stubEnv("WORKFLOW_SOUNDCHECK", "soundcheck");
    db = new FakeFirestore();
    executions = new FakeExecutions();
    openUpload = vi.fn(async () => SESSION);
    setClientOverride("firestore", db.asFirestore());
    setClientOverride("workflowExecutions", executions.asExecutions());
    await db.doc(`channels/${CHANNEL}`).set(channel);
    await db.doc(servingPaths(CHANNEL).summary).set({ channelId: CHANNEL });
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("names its workflow in full", () => {
    expect(soundcheckWorkflow()).toBe(WORKFLOW);
  });

  it("opens an upload of exactly this file and waits for it", async () => {
    const created = soundcheckCreatedSchema.parse(await create(file()));
    expect(created).toEqual({
      soundcheckId: expect.stringMatching(/^[0-9a-f]{32}$/),
      status: "awaiting_upload",
      upload: { sessionUrl: SESSION, chunkBytes: UPLOAD_CHUNK_BYTES },
    });
    const name = `${CHANNEL}/${created.soundcheckId}/source.mov`;
    expect(openUpload).toHaveBeenCalledWith({
      bucket: "test-uploads",
      name,
      contentType: "video/quicktime",
      sizeBytes: 900_000_000,
      origin: ORIGIN,
    });
    expect(stored(created.soundcheckId)).toMatchObject({
      status: "awaiting_upload",
      title: "Building a guitar",
      scenario: "search",
      input: { kind: "file", fileName: "rough cut v3.mov", uri: `gs://test-uploads/${name}` },
      createdAt: NOW.toISOString(),
    });
    // The upload's arrival starts the workflow (Eventarc), not this request.
    expect(executions.created).toEqual([]);
  });

  it("queues a link and starts the workflow for it", async () => {
    const created = await create(link());
    expect(created).toMatchObject({ status: "queued", upload: null });
    expect(stored(created.soundcheckId).input).toEqual({ kind: "youtube", videoId: "lgxOjPdCGkw" });
    expect(executions.created).toEqual([
      { parent: WORKFLOW, argument: { channel_id: CHANNEL, soundcheck_id: created.soundcheckId } },
    ]);
  });

  it("marks a link failed when the workflow cannot start", async () => {
    executions.failCreate = new Error("UNAVAILABLE");
    await expect(create(link())).rejects.toThrow("UNAVAILABLE");
    const [doc] = [...db.docs].filter(([path]) => path.includes("/soundchecks/")).map(([, d]) => d);
    expect(soundcheckDocSchema.parse(doc)).toMatchObject({
      status: "failed",
      error: { code: "internal" },
    });
  });

  it("refuses other types, files over 2 GB and links that are not YouTube videos", async () => {
    await expect(create(file({ contentType: "video/x-msvideo" }))).rejects.toMatchObject({
      code: "unsupported_type",
    });
    await expect(create(file({ sizeBytes: 2 * 1024 ** 3 + 1 }))).rejects.toMatchObject({
      code: "too_large",
    });
    await expect(create(link("https://vimeo.com/123"))).rejects.toBeInstanceOf(
      SoundcheckRejectedError,
    );
    expect(openUpload).not.toHaveBeenCalled();
    expect(db.docs.size).toBe(2);
  });

  it("refuses someone else's channel, an unbuilt one, and missing settings", async () => {
    await expect(create(link(), OTHER)).rejects.toBeInstanceOf(NotFoundError);
    db.docs.delete(servingPaths(CHANNEL).summary);
    await expect(create(link())).rejects.toBeInstanceOf(NotBuiltError);
    vi.stubEnv("WORKFLOW_SOUNDCHECK", "");
    resetEnvCache();
    await expect(create(link())).rejects.toBeInstanceOf(SoundcheckNotConfiguredError);
    vi.stubEnv("NEXT_PUBLIC_USE_FIXTURES", "true");
    resetEnvCache();
    await expect(create(link())).rejects.toBeInstanceOf(FixturesModeError);
    expect(executions.created).toEqual([]);
  });

  it("reads a soundcheck back for its owner only", async () => {
    const { soundcheckId } = await create(link());
    expect((await getSoundcheck(ME, CHANNEL, soundcheckId)).status).toBe("queued");
    await expect(getSoundcheck(OTHER, CHANNEL, soundcheckId)).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSoundcheck(ME, CHANNEL, "0".repeat(32))).rejects.toBeInstanceOf(NotFoundError);
    await expect(getSoundcheck(ME, CHANNEL, "../../users/x")).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("openUploadSession", () => {
  afterEach(() => {
    resetClients();
  });

  const request: UploadSessionRequest = {
    bucket: "test-uploads",
    name: `${CHANNEL}/0123456789abcdef0123456789abcdef/source.mp4`,
    contentType: "video/mp4",
    sizeBytes: 123_456_789,
    origin: ORIGIN,
  };

  it("asks for one new object of this type and size, and returns the session", async () => {
    const send = vi.fn(async () => ({ headers: new Headers({ location: SESSION }) }));
    setClientOverride("storage", { authClient: { request: send } } as never);
    await expect(openUploadSession(request)).resolves.toBe(SESSION);
    expect(send).toHaveBeenCalledWith({
      url:
        "https://storage.googleapis.com/upload/storage/v1/b/test-uploads/o?uploadType=resumable" +
        `&ifGenerationMatch=0&name=${encodeURIComponent(request.name)}`,
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": "123456789",
        Origin: ORIGIN,
      },
      data: { name: request.name, contentType: "video/mp4" },
    });
  });

  it("reads the session from plain-object headers too, and fails without one", async () => {
    setClientOverride("storage", {
      authClient: { request: async () => ({ headers: { location: SESSION } }) },
    } as never);
    await expect(openUploadSession(request)).resolves.toBe(SESSION);
    setClientOverride("storage", {
      authClient: { request: async () => ({ headers: {} }) },
    } as never);
    await expect(openUploadSession(request)).rejects.toThrow(/no upload session/);
  });
});
