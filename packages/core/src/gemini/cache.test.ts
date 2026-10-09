import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import {
  cacheObjectName,
  extractionCacheKey,
  promptHash,
  readCachedExtraction,
  writeCachedExtraction,
  type CachedExtraction,
} from "./cache";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const input = {
  sourceUri: "https://www.youtube.com/watch?v=fixtureVid1",
  extractionVersion: "beats-v1",
  modelId: "test-model",
  promptHash: promptHash("Annotate the video.", { type: "object" }),
  videoMode: "static",
};

describe("promptHash", () => {
  it("is stable and changes with the instruction or the schema", () => {
    const hash = promptHash("Annotate the video.", { type: "object" });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(promptHash("Annotate the video.", { type: "object" })).toBe(hash);
    expect(promptHash("Annotate the video!", { type: "object" })).not.toBe(hash);
    expect(promptHash("Annotate the video.", { type: "array" })).not.toBe(hash);
  });
});

describe("extractionCacheKey", () => {
  it("is stable for the same inputs", () => {
    expect(extractionCacheKey(input)).toBe(extractionCacheKey({ ...input }));
    expect(extractionCacheKey(input)).toMatch(/^[0-9a-f]{64}$/);
  });

  it.each(Object.keys(input))("changes when %s changes", (field) => {
    expect(extractionCacheKey({ ...input, [field]: "something else" })).not.toBe(
      extractionCacheKey(input),
    );
  });
});

describe("cacheObjectName", () => {
  const key = extractionCacheKey(input);

  it("lives under the channel", () => {
    expect(cacheObjectName(CHANNEL, "fixtureVid1", key)).toBe(
      `${CHANNEL}/beats/fixtureVid1/${key}.json`,
    );
  });

  it("rejects path tricks", () => {
    expect(() => cacheObjectName(CHANNEL, "../x", key)).toThrow(RangeError);
    expect(() => cacheObjectName(CHANNEL, "v", "../key")).toThrow(RangeError);
    expect(() => cacheObjectName("UC1", "v", key)).toThrow();
  });
});

describe("cached extractions", () => {
  let storage: FakeStorage;
  const entry: CachedExtraction = {
    key: extractionCacheKey(input),
    channel_id: CHANNEL,
    video_id: "fixtureVid1",
    source_uri: input.sourceUri,
    extraction_version: "beats-v1",
    gemini_model: "test-model",
    video_mode: "static",
    prompt_hash: input.promptHash,
    duration_s: 88,
    coverage: 1,
    extracted_at: "2026-10-08T10:00:00.000Z",
    usage: {
      calls: 1,
      prompt_tokens: 8_000,
      output_tokens: 900,
      thinking_tokens: 100,
      tool_use_tokens: 0,
      latency_ms: 12_000,
      cost_usd: null,
    },
    beats: {
      schema_version: "beats-v3",
      video_summary: "A video.",
      format: "other",
      title_promise: "Something.",
      target_level: 2,
      payoff_time_s: null,
      beats: [
        {
          start_s: 0,
          end_s: 88,
          beat_type: "explanation",
          talking_head_share: 5,
          visual: "none",
          cuts_per_min: 0,
          on_screen_text: false,
          music: "none",
          energy: 3,
          assumed_knowledge: 2,
          info_density: 3,
          opens_loop: null,
          closes_loop: false,
          speaker_count: 1,
          transcript: "",
          summary: "A beat.",
          words_per_minute: 0,
        },
      ],
    },
  };

  beforeEach(() => {
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    storage = new FakeStorage();
    setClientOverride("storage", storage.asStorage());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("round-trips a validated extraction", async () => {
    const name = await writeCachedExtraction(entry);
    expect(name).toBe(`${CHANNEL}/beats/fixtureVid1/${entry.key}.json`);
    expect(await readCachedExtraction(CHANNEL, "fixtureVid1", entry.key)).toEqual(entry);
  });

  it("misses when nothing is cached for the key", async () => {
    expect(await readCachedExtraction(CHANNEL, "fixtureVid1", entry.key)).toBeNull();
  });

  it("treats an unreadable entry as a miss", async () => {
    await storage
      .bucket("test-raw")
      .file(cacheObjectName(CHANNEL, "fixtureVid1", entry.key))
      .save("{not json");
    expect(await readCachedExtraction(CHANNEL, "fixtureVid1", entry.key)).toBeNull();
    await storage
      .bucket("test-raw")
      .file(cacheObjectName(CHANNEL, "fixtureVid1", entry.key))
      .save(JSON.stringify({ ...entry, beats: { beats: [] } }));
    expect(await readCachedExtraction(CHANNEL, "fixtureVid1", entry.key)).toBeNull();
  });

  it("refuses to cache an invalid extraction", async () => {
    await expect(writeCachedExtraction({ ...entry, coverage: 2 })).rejects.toThrow();
  });
});
