import { FEATURE_VERSION } from "@soundcheck/core";
import type { ExtractionSettings } from "@soundcheck/core/gemini";
import type { FakeBigQuery, FakeGenAI } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHANNEL, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { formatBaselineRun, runBaselineLlm } from "./run";

const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 0.75, outputPerM: 3.75 },
};
const points = Array.from({ length: 20 }, (_, i) => 0.9 - 0.03 * i);

describe("runBaselineLlm", () => {
  let bigquery: FakeBigQuery;
  let gemini: FakeGenAI;

  beforeEach(async () => {
    ({ bigquery, gemini } = await ingestTestbed());
    vi.stubEnv("MIN_TRAIN_VIDEOS", "30");
    gemini.respondWith(() => ({ text: JSON.stringify({ retention: points }) }));
    Object.assign(bigquery.tables, {
      feature_contexts: [
        {
          channel_id: CHANNEL,
          feature_version: FEATURE_VERSION,
          video_ids: ["vidA", "vidB", "vidC"],
          as_of: { value: "2026-10-03" },
        },
      ],
      videos: [
        ["vidA", "2022-05-08", 262],
        ["vidB", "2022-05-31", 222],
        ["vidC", "2023-03-26", 88],
        ["vidShort", "2022-06-12", 31],
      ].map(([id, day, duration]) => ({
        channel_id: CHANNEL,
        video_id: id,
        published_at: { value: `${day}T12:00:00.000Z` },
        duration_s: duration,
      })),
    });
  });

  afterEach(resetTestbed);

  const run = (
    options: {
      video?: string;
      noCache?: boolean;
      progress?: (done: number, total: number) => void;
    } = {},
  ) => runBaselineLlm({ channelId: CHANNEL, settings, log: quiet, ...options });

  it("asks about every usable video of a small channel and loads the curves", async () => {
    const progress = vi.fn();
    const result = await run({ progress });
    // Counted from 0 as soon as the videos are known, then one by one.
    expect(progress.mock.calls).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(result.mode).toBe("check");
    expect(result.outcomes.map((o) => [o.videoId, o.status])).toEqual([
      ["vidA", "predicted"],
      ["vidB", "predicted"],
      ["vidC", "predicted"],
    ]);
    expect(gemini.requests).toHaveLength(3);
    const rows = bigquery.tables.baseline_llm_curves ?? [];
    expect(rows.map((row) => row.video_id)).toEqual(["vidA", "vidB", "vidC"]);
    expect((rows[0]?.curve as number[]).length).toBe(100);
    expect(result.costUsd).toBeCloseTo(3 * 0.00975, 10);
    expect(JSON.stringify(gemini.requests[2]?.contents)).toContain("It lasts 1:28.");
  });

  it("costs nothing the second time, and can ask about one chosen video", async () => {
    await run();
    const again = await run();
    expect(again.outcomes.every((o) => o.status === "cached")).toBe(true);
    expect(gemini.requests).toHaveLength(3);
    const chosen = await run({ video: "vidShort", noCache: true });
    expect(chosen.mode).toBe("chosen");
    expect(chosen.outcomes.map((o) => o.videoId)).toEqual(["vidShort"]);
    expect(bigquery.tables.baseline_llm_curves).toHaveLength(4);
    await expect(run({ video: "someoneElses" })).rejects.toThrow(/not a video of/);
  });

  it("prints a short report", async () => {
    const text = formatBaselineRun(await run());
    expect(text).toContain("every video (check mode: too few videos to hold some out)");
    expect(text).toContain("vidC: predicted, ends at 33% still watching");
    expect(text).toMatch(/baseline_llm_curves: 3 rows; cost of new calls \$0\.029\d/);
  });

  it("needs the channel's features first", async () => {
    bigquery.tables.feature_contexts = [];
    await expect(run()).rejects.toThrow(/run "soundcheck features" first/);
  });
});
