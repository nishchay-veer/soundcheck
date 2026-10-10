import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeGenAI } from "../fake-genai";
import { FakeStorage } from "../fake-storage";
import { resetClients, setClientOverride } from "../gcp";
import { createLogger } from "../logger";
import { BASELINE_PROMPT_VERSION } from "../prompts";
import {
  baselineRequest,
  interpolateRetention,
  predictBaselineCurve,
  readBaselineCurves,
} from "./baseline";
import type { ExtractionSettings } from "./extract";

const CHANNEL = "UCaBcDeFgHiJkLmNoPqRsTuV";
const quiet = createLogger({ level: "silent" });
const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 0.75, outputPerM: 3.75 },
};
const target = { channelId: CHANNEL, videoId: "fixtureVid1", durationS: 222 };
/** Falls 4 points per step, from 0.9 at 5% to 0.14 at 100%. */
const points = Array.from({ length: 20 }, (_, i) => Number((0.9 - 0.04 * i).toFixed(2)));
const answer = (values: number[] = points) => ({ text: JSON.stringify({ retention: values }) });

describe("interpolateRetention", () => {
  it("hits each point at its 5% mark and draws straight lines from 1 at the start", () => {
    const { curve, repaired } = interpolateRetention(points);
    expect(curve).toHaveLength(100);
    expect(repaired).toBe(false);
    expect(curve[4]).toBeCloseTo(0.9, 12); // bin 5 ends at 5%
    expect(curve[99]).toBeCloseTo(0.14, 12);
    expect(curve[0]).toBeCloseTo(1 - 0.1 / 5, 12); // a fifth of the way from 1 to 0.9
    expect(curve[6]).toBeCloseTo(0.9 - 0.04 * (2 / 5), 12);
  });

  it("makes a curve that rises somewhere non-increasing, and says so", () => {
    const rising = [...points];
    rising[10] = 0.95;
    const { points: fixed, curve, repaired } = interpolateRetention(rising);
    expect(repaired).toBe(true);
    expect(fixed[10]).toBe(fixed[9]);
    expect(curve.every((value, i) => i === 0 || value <= (curve[i - 1] as number))).toBe(true);
    expect(() => interpolateRetention(points.slice(1))).toThrow(RangeError);
  });
});

describe("predictBaselineCurve", () => {
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

  const predict = (noCache = false) =>
    predictBaselineCurve(target, {
      settings,
      noCache,
      log: quiet,
      now: () => new Date("2026-10-10T12:00:00Z"),
    });

  it("asks Gemini about the video alone, archives the answer, and caches the curve", async () => {
    gemini.answer(answer());
    const outcome = await predict();
    expect(outcome.status).toBe("predicted");
    expect(outcome.row).toMatchObject({
      channel_id: CHANNEL,
      video_id: "fixtureVid1",
      prompt_version: BASELINE_PROMPT_VERSION,
      gemini_model: "test-model",
      video_mode: "static",
      cache_key: baselineRequest("fixtureVid1", settings).key,
      points,
      repaired: false,
      created_at: "2026-10-10T12:00:00.000Z",
    });
    // 8,000 tokens in, 1,000 out (answer and thinking) at the test prices.
    expect(outcome.row?.cost_usd).toBeCloseTo(0.00975, 10);

    const [request] = gemini.requests;
    const parts = (request?.contents as Array<{ parts: Array<Record<string, unknown>> }>)[0]?.parts;
    expect(parts?.[0]).toMatchObject({
      fileData: { fileUri: "https://www.youtube.com/watch?v=fixtureVid1" },
    });
    expect(parts?.[1]).toEqual({ text: "Predict this video's audience retention. It lasts 3:42." });
    expect(request?.config).toMatchObject({ temperature: 0, responseMimeType: "application/json" });
    expect(JSON.stringify(request?.config?.systemInstruction)).not.toContain(CHANNEL);

    const names = [...(storage.buckets["test-raw"] ?? [])];
    expect(names.some((n) => n.startsWith(`${CHANNEL}/gemini-baseline/fixtureVid1-a1/`))).toBe(
      true,
    );
    expect(names).toContain(`${CHANNEL}/baseline-llm/${outcome.row?.cache_key}.json`);

    expect((await predict()).status).toBe("cached");
    expect(gemini.requests).toHaveLength(1);
    gemini.answer(answer());
    expect((await predict(true)).status).toBe("predicted");
    expect(gemini.requests).toHaveLength(2);
  });

  it("retries an invalid answer once with its errors, then gives up", async () => {
    gemini.answer({ text: "not json" }, answer(points.slice(0, 19)));
    const outcome = await predict();
    expect(outcome.status).toBe("invalid");
    expect(outcome.errors[0]).toMatch(/retention/);
    const retry = JSON.stringify(gemini.requests[1]?.contents);
    expect(retry).toContain("Your previous answer was invalid: it is not valid JSON");

    gemini.answer({ text: "{}" }, answer());
    expect((await predict()).status).toBe("predicted");
  });

  it("reports a failed call without caching anything", async () => {
    gemini.answer(new Error("permission denied"));
    const outcome = await predict();
    expect(outcome).toMatchObject({ status: "failed", row: null, errors: ["permission denied"] });
    expect(await readBaselineCurves(CHANNEL)).toEqual([]);
  });

  it("lists every cached curve of the channel", async () => {
    gemini.answer(answer());
    await predict();
    const rows = await readBaselineCurves(CHANNEL);
    expect(rows.map((row) => row.video_id)).toEqual(["fixtureVid1"]);
  });
});
