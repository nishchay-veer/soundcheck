import { EXTRACTION_VERSION } from "@soundcheck/core";
import type { ExtractionSettings } from "@soundcheck/core/gemini";
import { clockToSeconds } from "@soundcheck/core/schemas";
import type { FakeBigQuery, FakeGenAI, FakeStorage } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNEL, NOW, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { CONSISTENCY_STAGE, formatConsistency, runConsistency } from "./run";

const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 0.75, outputPerM: 3.75 },
};
const videos = [
  { id: "fixtureVid1", kind: "talk" },
  { id: "fixtureVid3", kind: "music" },
];

type Request = Parameters<FakeGenAI["models"]["generateContent"]>[0];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/**
 * Covers the requested length in 30 s beats alternating setup and explanation.
 * With `vary`, odd seeds call the first beat "context" instead: a disagreement
 * the metrics should see.
 */
function answer(request: Request, vary: boolean) {
  const contents = request.contents as Array<{ parts: Array<{ text?: string }> }>;
  const text = contents[0]?.parts.find((part) => part.text)?.text ?? "";
  const duration = clockToSeconds(/It lasts (\d+:\d{2})\./.exec(text)?.[1] ?? "1:00");
  const seed = Number(request.config?.seed ?? 0);
  const beats = [];
  for (let start = 0, i = 0; start < duration; start += 30, i += 1) {
    const type = i % 2 === 0 ? "setup" : "explanation";
    beats.push({
      start: clock(start),
      end: clock(Math.min(start + 30, duration)),
      beat_type: vary && i === 0 && seed % 2 === 1 ? "context" : type,
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
    });
  }
  return {
    text: JSON.stringify({
      schema_version: "beats-v3",
      video_summary: "A video.",
      format: "explainer",
      title_promise: "Something.",
      target_level: 2,
      payoff_time: null,
      beats,
    }),
  };
}

describe("runConsistency", () => {
  let bigquery: FakeBigQuery;
  let storage: FakeStorage;
  let gemini: FakeGenAI;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];

  beforeEach(async () => {
    ({ bigquery, storage, gemini, connect } = await ingestTestbed());
  });

  afterEach(resetTestbed);

  const consistency = (options: { runs?: number } = {}) =>
    runConsistency({
      channelId: CHANNEL,
      settings,
      videos,
      log: quiet,
      connect,
      now: NOW,
      ...options,
    });

  it("extracts each video once per run with its own seed, never touching the cache", async () => {
    gemini.respondWith((request) => answer(request, true));
    const report = await consistency();
    expect(gemini.requests).toHaveLength(6);
    expect(new Set(gemini.requests.map((r) => r.config?.seed))).toEqual(
      new Set([20261004, 20261005, 20261006]),
    );
    expect(gemini.requests.every((r) => r.config?.temperature === 0)).toBe(true);
    const names = [...(storage.buckets["test-raw"] ?? [])];
    expect(names.some((name) => name.includes("/beats/"))).toBe(false);
    expect(names.filter((name) => name.includes("/consistency/"))).toHaveLength(6);
    expect(report.sweeps).toHaveLength(1);
  });

  it("measures disagreement between runs and applies the gate", async () => {
    gemini.respondWith((request) => answer(request, true));
    const report = await consistency();
    const [sweep] = report.sweeps;
    expect(sweep?.identical).toBe(false);
    expect(sweep?.pairs.map((pair) => pair.runs)).toEqual([
      [1, 2],
      [1, 3],
      [2, 3],
    ]);
    expect(sweep?.average.boundaryF1).toBe(1);
    expect(sweep?.average.beatTypeKappa).toBeLessThan(1);
    expect(sweep?.confusions.beat_type[0]).toMatchObject({ first: "context", second: "setup" });
    expect(sweep?.gate.checks.map((check) => check.metric)).toEqual([
      "boundary F1 (±3 s)",
      "beat_type kappa",
      "visual kappa",
      "energy weighted kappa",
      "assumed_knowledge weighted kappa",
      "info_density weighted kappa",
      "talking_head_share weighted kappa",
    ]);
  });

  it("adds a sensitivity sweep at 0.4 when every run is identical", async () => {
    gemini.respondWith((request) => answer(request, false));
    const report = await consistency();
    expect(report.sweeps.map((s) => [s.temperature, s.identical])).toEqual([
      [0, true],
      [0.4, true],
    ]);
    expect(gemini.requests.slice(6).every((r) => r.config?.temperature === 0.4)).toBe(true);
    expect(report.passed).toBe(true);
  });

  it("leaves a failed extraction out of its run's pairs and reports it", async () => {
    let calls = 0;
    gemini.respondWith((request) => {
      calls += 1;
      // Both answers for one video in one run are invalid JSON.
      return request.config?.seed === 20261005 &&
        JSON.stringify(request.contents).includes("fixtureVid3")
        ? { text: "not json" }
        : answer(request, false);
    });
    const report = await consistency();
    // 6 extractions; the failing one is asked twice (the answer and its one retry).
    expect(calls).toBe(7);
    expect(report.sweeps[0]?.failures).toEqual([
      {
        videoId: "fixtureVid3",
        run: 2,
        status: "invalid",
        errors: ["Your output is not valid JSON."],
      },
    ]);
    expect(report.sweeps[0]?.identical).toBe(false);
  });

  it("stores the report and loads every report into quality_reports", async () => {
    gemini.respondWith((request) => answer(request, true));
    const first = await consistency();
    const second = await consistency();
    const rows = bigquery.tables.quality_reports ?? [];
    expect(rows.map((row) => row.report_id).sort()).toEqual(
      [first.report_id, second.report_id].sort(),
    );
    expect(rows[0]).toMatchObject({
      channel_id: CHANNEL,
      stage: CONSISTENCY_STAGE,
      details: expect.objectContaining({
        extraction_version: EXTRACTION_VERSION,
        gemini_model: "test-model",
      }),
    });
    expect(first.usage).toMatchObject({ calls: 6, tokens_in: 48_000, tokens_out: 6_000 });
    expect(first.usage.video_minutes).toBeCloseTo(((88 + 222) * 3) / 60, 9);
  });

  it("prints each check against its threshold and the verdict", async () => {
    gemini.respondWith((request) => answer(request, true));
    const text = formatConsistency(await consistency());
    expect(text).toMatch(/PASS {2}boundary F1 \(±3 s\)\s+1\.00 {3}\(needs 0\.70\)/);
    expect(text).toMatch(/beat_type kappa/);
    expect(text).toMatch(/Most confused beat_type: context\/setup/);
    expect(text).toMatch(/Gate at temperature 0: (PASSED|FAILED)/);
    expect(text).toMatch(/6 Gemini calls, 48000 tokens in, 6000 out, cost \$0\.06/);
  });

  it("needs at least two runs", async () => {
    await expect(consistency({ runs: 1 })).rejects.toThrow(RangeError);
  });
});
