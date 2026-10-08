import { MediaProcessing } from "@google/genai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeGenAI } from "../fake-genai";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { beatExtractionPrompt } from "../prompts";
import { geminiResponseJsonSchema } from "../schemas";
import { cacheObjectName } from "./cache";
import {
  EXTRACTION_SEED,
  estimateCost,
  extractVideoBeats,
  extractionRequest,
  type ExtractionSettings,
} from "./extract";
import { formatClock } from "./validate-beats";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const quiet = createLogger({ level: "silent" });
const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 1.35, outputPerM: 7.5 },
};
const target = {
  channelId: CHANNEL,
  videoId: "fixtureVid1",
  durationS: 88,
  privacyStatus: "public",
};

const beat = (start: number, end: number) => ({
  start: formatClock(start),
  end: formatClock(end),
  beat_type: "explanation",
  framing: "talking_head",
  cuts_per_min: 0,
  on_screen_text: false,
  music: "none",
  energy: 3,
  assumed_knowledge: 2,
  info_density: 3,
  opens_loop: null,
  closes_loop: false,
  speaker_count: 1,
  transcript: "hello there",
  summary: "A beat.",
});
const answer = (spans: Array<[number, number]>) => ({
  text: JSON.stringify({
    schema_version: "beats-v2",
    video_summary: "A video.",
    format: "other",
    title_promise: "Something.",
    target_level: 2,
    payoff_time: null,
    beats: spans.map(([start, end]) => beat(start, end)),
  }),
});

describe("extractVideoBeats", () => {
  let gemini: FakeGenAI;
  let storage: FakeStorage;

  beforeEach(() => {
    vi.stubEnv("GCS_RAW_BUCKET", "test-raw");
    gemini = new FakeGenAI();
    storage = new FakeStorage();
    setClientOverride("genai", gemini.asGenAI());
    setClientOverride("storage", storage.asStorage());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  const extract = (
    options: { noCache?: boolean; settings?: ExtractionSettings } = {},
    t = target,
  ) => extractVideoBeats(t, { settings, log: quiet, ...options });

  it("asks Gemini once for a short video, with the prompt, schema and static video", async () => {
    gemini.answer(
      answer([
        [0, 40],
        [40, 88],
      ]),
    );
    const outcome = await extract();

    expect(outcome.status).toBe("extracted");
    expect(outcome.extraction?.beats.beats.map((b) => [b.start_s, b.end_s])).toEqual([
      [0, 40],
      [40, 88],
    ]);
    const [request] = gemini.requests;
    expect(request?.model).toBe("test-model");
    expect(request?.config).toMatchObject({
      systemInstruction: beatExtractionPrompt(),
      temperature: 0,
      seed: EXTRACTION_SEED,
      responseMimeType: "application/json",
      responseJsonSchema: geminiResponseJsonSchema(),
    });
    const parts = (request?.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]?.parts;
    expect(parts?.[0]).toEqual({
      fileData: { fileUri: "https://www.youtube.com/watch?v=fixtureVid1", mimeType: "video/*" },
      mediaProcessing: MediaProcessing.STATIC,
    });
    expect(parts?.[1]).toEqual({ text: "Annotate this video. It lasts 1:28." });
  });

  it("caches the validated result and archives the raw answer", async () => {
    gemini.answer(answer([[0, 88]]));
    const outcome = await extract();
    const cached = storage.read(
      `gs://test-raw/${cacheObjectName(CHANNEL, "fixtureVid1", outcome.key)}`,
    );
    expect(JSON.parse(cached ?? "null")).toMatchObject({
      key: outcome.key,
      coverage: 1,
      gemini_model: "test-model",
    });
    const raw = [...(storage.buckets["test-raw"] ?? [])].filter((name) =>
      name.includes("/gemini-beats/"),
    );
    expect(raw).toEqual([
      expect.stringMatching(
        new RegExp(`^${CHANNEL}/gemini-beats/fixtureVid1-w0-a1/\\d{8}\\.json$`),
      ),
    ]);
  });

  it("costs nothing on a re-run: the cache answers", async () => {
    gemini.answer(answer([[0, 88]]));
    const first = await extract();
    const second = await extract();
    expect(second.status).toBe("cached");
    expect(second.extraction).toEqual(first.extraction);
    expect(second.usage).toMatchObject({
      calls: 0,
      prompt_tokens: 0,
      output_tokens: 0,
      cost_usd: 0,
    });
    expect(gemini.requests).toHaveLength(1);
  });

  it("asks again with --no-cache", async () => {
    gemini.answer(answer([[0, 88]]), answer([[0, 88]]));
    await extract();
    expect((await extract({ noCache: true })).status).toBe("extracted");
    expect(gemini.requests).toHaveLength(2);
  });

  it("retries once with the specific errors, then succeeds", async () => {
    gemini.answer(
      answer([[0, 40]]),
      answer([
        [0, 40],
        [40, 88],
      ]),
    );
    const outcome = await extract();
    expect(outcome.status).toBe("extracted");
    expect(outcome.usage.calls).toBe(2);
    const retry = gemini.requests[1]?.contents as Array<{
      role: string;
      parts: Array<{ text?: string }>;
    }>;
    expect(retry.map((c) => c.role)).toEqual(["user", "model", "user"]);
    expect(retry[2]?.parts[0]?.text).toMatch(
      /Your answer has these problems:\n- Your output covers 45% of the video; it has a gap from 0:40 to 1:28/,
    );
    expect(outcome.calls.map((c) => c.valid)).toEqual([false, true]);
  });

  it("gives up after a second invalid answer, caching nothing", async () => {
    gemini.answer({ text: "not json" }, answer([[0, 40]]));
    const outcome = await extract();
    expect(outcome.status).toBe("invalid");
    expect(outcome.errors[0]).toMatch(/covers 45%/);
    expect(outcome.calls[0]?.errors).toEqual(["Your output is not valid JSON."]);
    expect([...(storage.buckets["test-raw"] ?? [])].some((name) => name.includes("/beats/"))).toBe(
      false,
    );
  });

  it("marks a private video without calling Gemini", async () => {
    const outcome = await extract({}, { ...target, privacyStatus: "private" });
    expect(outcome.status).toBe("private_unavailable");
    expect(gemini.requests).toHaveLength(0);
  });

  it("reports a failed call with the API's message", async () => {
    gemini.answer(
      Object.assign(new Error("Cannot fetch content from the provided URL."), { status: 400 }),
    );
    const outcome = await extract();
    expect(outcome).toMatchObject({
      status: "failed",
      errors: ["HTTP 400: Cannot fetch content from the provided URL."],
    });
  });

  it("uses agentic processing when configured, under a different cache key", async () => {
    gemini.answer(answer([[0, 88]]));
    const agentic = { ...settings, videoMode: "agentic" as const };
    const outcome = await extract({ settings: agentic });
    const parts = (
      gemini.requests[0]?.contents as Array<{ parts: Array<Record<string, unknown>> }>
    )[0]?.parts;
    expect(parts?.[0]?.mediaProcessing).toBe(MediaProcessing.AGENTIC);
    expect(outcome.key).not.toBe(extractionRequest("fixtureVid1", settings).key);
  });

  it("extracts a long video in windows and stitches them into video time", async () => {
    // 41 minutes: windows 0-20:00, 19:30-39:30 and 39:00-41:00, each answered in window time.
    const thirds: Array<[number, number]> = [
      [0, 400],
      [400, 800],
      [800, 1_200],
    ];
    gemini.answer(answer(thirds), answer(thirds), answer([[0, 120]]));
    const outcome = await extract({}, { ...target, durationS: 2_460 });
    expect(outcome.status).toBe("extracted");
    const second = gemini.requests[1]?.contents as Array<{ parts: Array<Record<string, unknown>> }>;
    expect(second[0]?.parts[0]?.videoMetadata).toEqual({
      startOffset: "1170s",
      endOffset: "2370s",
    });
    expect(second[0]?.parts[1]?.text).toMatch(/from 19:30 to 39:30.*"0:00" is 19:30/);
    // Joining 800-1200 with 1170-1570 would exceed 600 s, so the later beat starts at 20:00;
    // 1970-2370 and the last window's 2340-2460 join into one 490 s beat.
    expect(outcome.extraction?.beats.beats.map((b) => [b.start_s, b.end_s])).toEqual([
      [0, 400],
      [400, 800],
      [800, 1_200],
      [1_200, 1_570],
      [1_570, 1_970],
      [1_970, 2_460],
    ]);
    expect(outcome.extraction?.coverage).toBe(1);
  });

  it("takes temperature, seed, archive location and cache writes as options", async () => {
    gemini.answer(answer([[0, 88]]));
    const outcome = await extractVideoBeats(target, {
      settings,
      log: quiet,
      noCache: true,
      writeCache: false,
      temperature: 0.4,
      seed: 7,
      archive: { source: "consistency", label: "run1-fixtureVid1-r2" },
    });
    expect(outcome.status).toBe("extracted");
    expect(gemini.requests[0]?.config).toMatchObject({ temperature: 0.4, seed: 7 });
    const names = [...(storage.buckets["test-raw"] ?? [])];
    expect(names).toEqual([
      expect.stringMatching(new RegExp(`^${CHANNEL}/consistency/run1-fixtureVid1-r2-w0-a1/`)),
    ]);
    expect(names.some((name) => name.includes("/beats/"))).toBe(false);
  });

  it("estimates cost from tokens and the configured prices", async () => {
    gemini.answer({
      ...answer([[0, 88]]),
      usage: { promptTokenCount: 10_000, candidatesTokenCount: 1_000, thoughtsTokenCount: 0 },
    });
    const outcome = await extract();
    expect(outcome.usage.cost_usd).toBeCloseTo((10_000 * 1.35 + 1_000 * 7.5) / 1e6, 12);
    expect(estimateCost(outcome.usage, {})).toBeNull();
  });
});
