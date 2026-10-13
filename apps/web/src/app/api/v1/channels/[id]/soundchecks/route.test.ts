import {
  FixturesModeError,
  NotBuiltError,
  NotFoundError,
  SoundcheckNotConfiguredError,
  SoundcheckRejectedError,
} from "@soundcheck/core";
import { createSoundcheck, getSoundcheck } from "@soundcheck/core/data";
import { soundcheckCreatedSchema, type SoundcheckDoc } from "@soundcheck/core/schemas";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/auth";
import { GET } from "./[soundcheckId]/route";
import { POST } from "./route";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@soundcheck/core/data", () => ({ createSoundcheck: vi.fn(), getSoundcheck: vi.fn() }));

const CHANNEL_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const USER = "111111111111111111111";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const SESSION = "https://storage.googleapis.com/upload/storage/v1/b/u/o?upload_id=abc";
const mockAuth = vi.mocked(auth as unknown as () => Promise<{ userId?: string } | null>);

const post = (body: unknown, origin: string | null = "https://soundcheck.example") =>
  POST(
    new Request(`http://localhost:3000/api/v1/channels/${CHANNEL_ID}/soundchecks`, {
      method: "POST",
      headers: { "content-type": "application/json", ...(origin ? { origin } : {}) },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: CHANNEL_ID }) },
  );
const file = {
  kind: "file",
  fileName: "cut.mp4",
  contentType: "video/mp4",
  sizeBytes: 1000,
  title: "A cut",
  scenario: "search",
};

describe("POST /api/v1/channels/[id]/soundchecks", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns 401 without a session", async () => {
    mockAuth.mockResolvedValue(null);
    expect((await post(file)).status).toBe(401);
    expect(createSoundcheck).not.toHaveBeenCalled();
  });

  it("creates the soundcheck for the page's origin and answers 201 with the upload", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(createSoundcheck).mockResolvedValue({
      soundcheckId: ID,
      status: "awaiting_upload",
      upload: { sessionUrl: SESSION, chunkBytes: 8 * 1024 * 1024 },
    });
    const response = await post(file);
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(soundcheckCreatedSchema.parse(await response.json())).toMatchObject({
      soundcheckId: ID,
    });
    expect(createSoundcheck).toHaveBeenCalledWith(USER, CHANNEL_ID, file, {
      origin: "https://soundcheck.example",
    });
  });

  it("fills in defaults, and uses the request's own origin when the browser sends none", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(createSoundcheck).mockResolvedValue({
      soundcheckId: ID,
      status: "queued",
      upload: null,
    });
    expect(
      (await post({ kind: "youtube", link: "https://youtu.be/lgxOjPdCGkw" }, null)).status,
    ).toBe(201);
    expect(createSoundcheck).toHaveBeenCalledWith(
      USER,
      CHANNEL_ID,
      { kind: "youtube", link: "https://youtu.be/lgxOjPdCGkw", title: "", scenario: "recent" },
      { origin: "http://localhost:3000" },
    );
  });

  it("answers 400 to a body it cannot read, before doing anything", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    for (const body of [
      "not json",
      { kind: "script", text: "Hi" },
      { ...file, scenario: "viral" },
    ]) {
      const response = await post(body);
      expect([response.status, await response.json()]).toEqual([400, { error: "invalid_request" }]);
    }
    expect(createSoundcheck).not.toHaveBeenCalled();
  });

  it.each([
    [new NotFoundError("channel"), 404, { error: "not_found" }],
    [
      new SoundcheckRejectedError("unsupported_type", "MP4, MOV or WebM."),
      415,
      { error: "unsupported_type", message: "MP4, MOV or WebM." },
    ],
    [
      new SoundcheckRejectedError("too_large", "Over 2 GB."),
      413,
      { error: "too_large", message: "Over 2 GB." },
    ],
    [
      new SoundcheckRejectedError("invalid_link", "Not a video."),
      400,
      { error: "invalid_link", message: "Not a video." },
    ],
    [new NotBuiltError(CHANNEL_ID), 409, { error: "not_built" }],
    [new SoundcheckNotConfiguredError(), 503, { error: "soundchecks_not_configured" }],
    [new FixturesModeError("starting a soundcheck"), 503, { error: "fixtures_mode" }],
  ])("maps %s to %i", async (error, status, body) => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(createSoundcheck).mockRejectedValue(error);
    const response = await post(file);
    expect([response.status, await response.json()]).toEqual([status, body]);
  });
});

describe("GET /api/v1/channels/[id]/soundchecks/[soundcheckId]", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  const get = (soundcheckId = ID) =>
    GET(
      new Request(
        `http://localhost:3000/api/v1/channels/${CHANNEL_ID}/soundchecks/${soundcheckId}`,
      ),
      {
        params: Promise.resolve({ id: CHANNEL_ID, soundcheckId }),
      },
    );

  it("returns the soundcheck to its owner, never cached, and 404 otherwise", async () => {
    mockAuth.mockResolvedValue({ userId: USER });
    vi.mocked(getSoundcheck).mockResolvedValueOnce({
      soundcheckId: ID,
      status: "running",
    } as SoundcheckDoc);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(getSoundcheck).toHaveBeenCalledWith(USER, CHANNEL_ID, ID);
    vi.mocked(getSoundcheck).mockRejectedValueOnce(new NotFoundError("soundcheck"));
    expect((await get()).status).toBe(404);
  });
});
