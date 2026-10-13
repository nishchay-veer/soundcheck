import { readFileSync } from "node:fs";
import {
  EXTRACTION_VERSION,
  createLogger,
  resetClients,
  resetEnvCache,
  setClientOverride,
} from "@soundcheck/core";
import type { ExtractionOutcome, ExtractionTarget } from "@soundcheck/core/gemini";
import { loadArtifact } from "@soundcheck/core/model";
import {
  soundcheckDocSchema,
  soundcheckInputsSchema,
  soundcheckPaths,
  type ModelArtifact,
  type SoundcheckDoc,
  type VideoBeats,
} from "@soundcheck/core/schemas";
import { FakeFirestore } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ChannelForCut } from "./channel";
import { formatSoundcheck } from "./index";
import { FAILURE_MESSAGES, STALE_AFTER_MS, runSoundcheck, type SoundcheckDeps } from "./run";

const CHANNEL = "UC-BHlgFbFh3V76yth-XCmlw";
const ID = "8f14e45fceea167a5a36dedd4bea2543";
const LINKED = "lgxOjPdCGkw";
const NOW = new Date("2026-10-13T09:00:00.000Z");
const quiet = createLogger({ level: "silent" });
const paths = soundcheckPaths(CHANNEL);

const newcomers = loadArtifact(
  JSON.parse(
    readFileSync(
      new URL("../../../../../tests/fixtures/parity/artifact.json", import.meta.url),
      "utf8",
    ),
  ),
);
const subscribers: ModelArtifact = {
  ...newcomers,
  audience: "subscribed",
  featureNames: ["pos_b1", "energy"],
  droppedFeatures: [],
  unpenalized: ["pos_b1"],
  mean: [0.3, 3],
  sd: [0.2, 1],
  alpha: -3.5,
  beta: [0.4, -0.3],
  cov: [
    [0.04, 0.012, -0.006],
    [0.012, 0.09, 0.018],
    [-0.006, 0.018, 0.0225],
  ],
};
const channel: ChannelForCut = {
  models: {
    subscribed: { artifact: subscribers, artifactUri: "gs://media/models/sub.json", inflation: 1 },
    unsubscribed: { artifact: newcomers, artifactUri: "gs://media/models/new.json", inflation: 1 },
  },
  recent: [
    {
      mix: { search: 0.2, suggested: 0.5, browse: 0.2 },
      views: { subscribed: 20, unsubscribed: 80 },
    },
  ],
  recentAvp: [36.9, 42.8, 67.8],
};

const beat = (start: number, end: number) => ({
  start_s: start,
  end_s: end,
  beat_type: "explanation" as const,
  talking_head_share: 4,
  visual: "none" as const,
  cuts_per_min: 6,
  on_screen_text: false,
  music: "none" as const,
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  speaker_count: 1,
  transcript: "Some words about guitars.",
  summary: "Playing the guitar.",
  words_per_minute: 150,
});
const watched = (durationS: number): VideoBeats =>
  ({
    schema_version: "beats-v3",
    video_summary: "A cover.",
    format: "performance",
    title_promise: "A song.",
    target_level: 1,
    payoff_time_s: null,
    beats: [beat(0, 30), beat(30, durationS)],
  }) as VideoBeats;

function outcome(status: ExtractionOutcome["status"], target: ExtractionTarget): ExtractionOutcome {
  return {
    videoId: target.videoId,
    status,
    key: "k".repeat(64),
    startedAt: NOW,
    finishedAt: NOW,
    extraction:
      status === "extracted"
        ? ({ beats: watched(target.durationS) } as ExtractionOutcome["extraction"])
        : null,
    errors: status === "extracted" ? [] : ["Your output is not valid JSON."],
    usage: {
      calls: 1,
      prompt_tokens: 20_000,
      output_tokens: 2_000,
      thinking_tokens: 0,
      tool_use_tokens: 0,
      latency_ms: 40_000,
      cost_usd: 0.02,
    },
    calls: [],
  };
}

/** Fakes for the outside world; each stays a mock, so tests can read its calls. */
function deps(overrides: Partial<{ [K in keyof SoundcheckDeps]: Mock<SoundcheckDeps[K]> }> = {}) {
  return {
    probeUpload: vi.fn(async () => ({ durationS: 312.5, hasVideo: true })),
    lookupVideo: vi.fn(async () => ({ durationS: 262, privacyStatus: "unlisted" })),
    extract: vi.fn(async (target: ExtractionTarget) => outcome("extracted", target)),
    readChannel: vi.fn(async () => channel),
    ...overrides,
  };
}

const base = (): SoundcheckDoc => ({
  soundcheckId: ID,
  channelId: CHANNEL,
  status: "queued",
  title: "New cover",
  scenario: "recent",
  input: { kind: "youtube", videoId: LINKED },
  progress: null,
  error: null,
  durationS: null,
  beats: null,
  prediction: null,
  edits: [],
  narrative: null,
  extractionVersion: EXTRACTION_VERSION,
  featureVersion: "f1",
  createdAt: "2026-10-13T08:59:00.000Z",
  updatedAt: "2026-10-13T08:59:00.000Z",
});
const upload = (): SoundcheckDoc => ({
  ...base(),
  status: "awaiting_upload",
  input: {
    kind: "file",
    fileName: "cut v3.mp4",
    contentType: "video/mp4",
    sizeBytes: 800_000_000,
    uri: `gs://test-uploads/${CHANNEL}/${ID}/source.mp4`,
  },
});

let db: FakeFirestore;
const stored = () => soundcheckDocSchema.parse(db.docs.get(paths.soundcheck(ID)));
const run = (d: SoundcheckDeps, now = NOW) =>
  runSoundcheck({ channelId: CHANNEL, soundcheckId: ID, now: () => now, log: quiet, deps: d });

beforeEach(async () => {
  vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
  vi.stubEnv("GCS_UPLOADS_BUCKET", "test-uploads");
  db = new FakeFirestore();
  setClientOverride("firestore", db.asFirestore());
});

afterEach(() => {
  resetClients();
  vi.unstubAllEnvs();
  resetEnvCache();
});

describe("runSoundcheck: a link", () => {
  it("checks, watches and predicts it, then saves the result and the model's inputs", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    const d = deps();
    expect(await run(d)).toEqual({ soundcheckId: ID, status: "ready", durationS: 262, beats: 2 });

    expect(d.lookupVideo).toHaveBeenCalledWith(CHANNEL, LINKED, ID);
    expect(d.probeUpload).not.toHaveBeenCalled();
    const [target, options] = d.extract.mock.calls[0] as unknown as [ExtractionTarget, object];
    expect(target).toEqual({
      channelId: CHANNEL,
      videoId: LINKED,
      durationS: 262,
      privacyStatus: "unlisted",
    });
    // Uncached, archived with the upload so it is deleted after 30 days.
    expect(options).toMatchObject({
      noCache: true,
      writeCache: false,
      archive: { source: "soundcheck-beats", label: ID, bucket: "test-uploads" },
    });

    const doc = stored();
    expect(doc).toMatchObject({
      status: "ready",
      error: null,
      durationS: 262,
      progress: { step: "finishing", message: "Done", done: 4, total: 4 },
    });
    expect(doc.beats).toHaveLength(2);
    expect(doc.prediction?.audiences.unsubscribed?.model.usable).toBe(false);
    expect(doc.prediction?.comparedVideos).toBe(3);
    expect(doc.narrative).toMatch(/^Subscribers should watch about \d+% of this cut/);

    const inputs = soundcheckInputsSchema.parse(db.docs.get(paths.inputs(ID)));
    expect(inputs).toMatchObject({ durationS: 262, scenario: "recent", seed: 1 });
    expect(JSON.stringify(inputs)).not.toContain("guitars");
  });

  it("refuses a private video before asking Gemini", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    const d = deps({
      lookupVideo: vi.fn(async () => ({ durationS: 262, privacyStatus: "private" })),
    });
    expect(await run(d)).toEqual({ soundcheckId: ID, status: "failed", code: "private_video" });
    expect(d.extract).not.toHaveBeenCalled();
    expect(stored()).toMatchObject({
      status: "failed",
      error: { code: "private_video", message: FAILURE_MESSAGES.private_video },
    });
  });

  it("says when the video cannot be found", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    expect(await run(deps({ lookupVideo: vi.fn(async () => null) }))).toMatchObject({
      status: "failed",
      code: "video_unavailable",
    });
  });
});

describe("runSoundcheck: an upload", () => {
  it("probes the file and has Gemini watch it from Cloud Storage", async () => {
    await db.doc(paths.soundcheck(ID)).set(upload());
    const d = deps();
    expect(await run(d)).toMatchObject({ status: "ready", durationS: 312.5 });
    expect(d.probeUpload).toHaveBeenCalledWith(`gs://test-uploads/${CHANNEL}/${ID}/source.mp4`);
    expect(d.lookupVideo).not.toHaveBeenCalled();
    const [target] = d.extract.mock.calls[0] as unknown as [ExtractionTarget];
    expect(target).toMatchObject({
      videoId: ID,
      durationS: 312.5,
      sourceUri: `gs://test-uploads/${CHANNEL}/${ID}/source.mp4`,
    });
  });

  it.each([
    [{ durationS: 45, hasVideo: true }, "too_short"],
    [{ durationS: 3_601, hasVideo: true }, "too_long"],
    [{ durationS: 300, hasVideo: false }, "unsupported_type"],
  ] as const)("refuses %j as %s", async (probed, code) => {
    await db.doc(paths.soundcheck(ID)).set(upload());
    const d = deps({ probeUpload: vi.fn(async () => probed) });
    expect(await run(d)).toEqual({ soundcheckId: ID, status: "failed", code });
    expect(d.extract).not.toHaveBeenCalled();
    expect(stored().error?.code).toBe(code);
  });
});

describe("runSoundcheck: what goes wrong later", () => {
  it("says so when Gemini's answers fail validation", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    const d = deps({
      extract: vi.fn(async (target: ExtractionTarget) => outcome("invalid", target)),
    });
    expect(await run(d)).toMatchObject({ status: "failed", code: "unreadable" });
    expect(d.readChannel).not.toHaveBeenCalled();
  });

  it("says so when the channel has no model yet", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    const d = deps({ readChannel: vi.fn(async () => ({ ...channel, models: {} })) });
    expect(await run(d)).toMatchObject({ status: "failed", code: "no_model" });
    expect(stored().beats).toHaveLength(2);
  });

  it("marks anything unexpected as failed, then throws so Cloud Run retries", async () => {
    await db.doc(paths.soundcheck(ID)).set(base());
    const d = deps({
      readChannel: vi.fn(async () => Promise.reject(new Error("BigQuery is down"))),
    });
    await expect(run(d)).rejects.toThrow("BigQuery is down");
    expect(stored()).toMatchObject({
      status: "failed",
      error: { code: "internal", message: FAILURE_MESSAGES.internal },
    });
  });
});

describe("runSoundcheck: claiming", () => {
  it("leaves a finished or busy soundcheck alone, and a missing one", async () => {
    const d = deps();
    expect(await run(d)).toMatchObject({ status: "skipped", reason: "no such soundcheck" });

    await db.doc(paths.soundcheck(ID)).set(base());
    await run(d);
    expect(await run(d)).toMatchObject({ status: "skipped", reason: "already finished" });

    await db.doc(paths.soundcheck(ID)).set({
      ...base(),
      status: "running",
      updatedAt: new Date(NOW.getTime() - 60_000).toISOString(),
    });
    expect(await run(d)).toMatchObject({ status: "skipped", reason: "already running" });
    expect(d.extract).toHaveBeenCalledTimes(1);
  });

  it("takes over a run that stopped, and retries a failed one", async () => {
    const d = deps();
    await db.doc(paths.soundcheck(ID)).set({
      ...base(),
      status: "running",
      updatedAt: new Date(NOW.getTime() - STALE_AFTER_MS - 1).toISOString(),
    });
    expect(await run(d)).toMatchObject({ status: "ready" });

    await db.doc(paths.soundcheck(ID)).set({
      ...base(),
      status: "failed",
      error: { code: "internal", message: FAILURE_MESSAGES.internal },
    });
    expect(await run(d)).toMatchObject({ status: "ready" });
    expect(stored().error).toBeNull();
  });
});

describe("formatSoundcheck", () => {
  it("says what happened in one line", () => {
    expect(
      formatSoundcheck({ soundcheckId: ID, status: "ready", durationS: 262.4, beats: 7 }),
    ).toBe(`soundcheck ${ID}: ready (262 s, 7 beats)`);
    expect(formatSoundcheck({ soundcheckId: ID, status: "failed", code: "too_long" })).toBe(
      `soundcheck ${ID}: failed (too_long)`,
    );
  });
});
