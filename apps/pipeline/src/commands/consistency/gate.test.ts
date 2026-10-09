import { EXTRACTION_VERSION } from "@soundcheck/core";
import { writeQualityReport } from "@soundcheck/core/jobs";
import type { FakeBigQuery } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNEL, NOW, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { GATE_STAGE, formatGateSummary, summarizeGate } from "./gate";
import { HUMAN_AGREEMENT_STAGE } from "./human";
import { CONSISTENCY_STAGE } from "./run";

const average = (beatType: number, extra: Record<string, unknown> = {}) => ({
  boundaryF1: 0.8,
  beatTypeKappa: beatType,
  visualKappa: 0.81,
  ordinal: { energy: 0.75, assumed_knowledge: 0.78, info_density: 0.78, talking_head_share: 0.7 },
  payoff: { meanAbsS: 1, compared: 10, oneMissing: 0 },
  seconds: 3900,
  videos: 6,
  ...extra,
});

const consistency = (
  id: string,
  createdAt: string,
  version: string,
  passed: boolean,
  avg: object,
) => ({
  report_id: id,
  channel_id: CHANNEL,
  stage: CONSISTENCY_STAGE,
  run_id: id,
  created_at: createdAt,
  details: {
    extraction_version: version,
    passed,
    sweeps: [{ average: avg }],
    usage: { cost_usd: 1.2, video_minutes: 195 },
  },
});

describe("summarizeGate", () => {
  let bigquery: FakeBigQuery;

  beforeEach(async () => {
    ({ bigquery } = await ingestTestbed());
    // An old iteration (before framing became visual) and the current one.
    await writeQualityReport(
      consistency("first", "2026-10-08T10:00:00.000Z", "beats-v1", false, {
        ...average(0.58),
        visualKappa: undefined,
        framingKappa: 0.42,
        ordinal: { energy: 0.72, assumed_knowledge: 0.9, info_density: 0.83 },
      }),
    );
    await writeQualityReport(
      consistency("latest", "2026-10-09T10:00:00.000Z", EXTRACTION_VERSION, true, average(0.65)),
    );
    await writeQualityReport({
      report_id: "human",
      channel_id: CHANNEL,
      stage: HUMAN_AGREEMENT_STAGE,
      run_id: "human",
      created_at: "2026-10-09T11:00:00.000Z",
      details: {
        report_id: "human",
        extraction_version: EXTRACTION_VERSION,
        method: "reviewed-draft",
        pooled: { kappa: 0.68, agreement: 0.82, boundaryF1: 0.81, seconds: 1052 },
        videos: [
          { videoId: "a", durationS: 157, humanBeats: 10, changedBeats: 0 },
          { videoId: "b", durationS: 895, humanBeats: 30, changedBeats: 2 },
        ],
        cost_usd: 0.13,
      },
    });
  });

  afterEach(resetTestbed);

  it("takes the verdict from the latest report for the current version", async () => {
    const summary = await summarizeGate({ channelId: CHANNEL, log: quiet, now: NOW });
    expect(summary).toMatchObject({
      extraction_version: EXTRACTION_VERSION,
      passed: true,
      iterations: [
        { report_id: "first", passed: false },
        { report_id: "latest", passed: true },
      ],
      human: { method: "reviewed-draft", kappa: 0.68, changed_beats: 2, labelled_beats: 40 },
    });
    expect(summary.cost.usd).toBeCloseTo(1.2 + 1.2 + 0.13, 9);
    expect(summary.cost.video_minutes).toBeCloseTo(195 * 2 + (157 + 895) / 60, 9);
  });

  it("writes the summary to quality_reports next to the iterations", async () => {
    await summarizeGate({ channelId: CHANNEL, log: quiet, now: new Date("2026-10-10T00:00:00Z") });
    expect(bigquery.tables.quality_reports?.map((row) => row.stage)).toEqual([
      CONSISTENCY_STAGE,
      CONSISTENCY_STAGE,
      HUMAN_AGREEMENT_STAGE,
      GATE_STAGE,
    ]);
  });

  it("prints a Markdown table, including old framing scores", async () => {
    const text = formatGateSummary(
      await summarizeGate({ channelId: CHANNEL, log: quiet, now: NOW }),
    );
    expect(text).toContain(
      "| 0 | beats-v1 | 0.80 | 0.58 | 0.42 | 0.72 | 0.90 | 0.83 | n/a | fail |",
    );
    expect(text).toContain(
      `| 1 | ${EXTRACTION_VERSION} | 0.80 | 0.65 | 0.81 | 0.75 | 0.78 | 0.78 | 0.70 | pass |`,
    );
    expect(text).toContain(`Gate for ${EXTRACTION_VERSION}: PASSED.`);
    expect(text).toMatch(/Human agreement \(reviewed-draft\): kappa 0\.68.*2 of 40 beats changed/);
  });

  it("does not pass a version that has no consistency report", async () => {
    resetTestbed();
    await ingestTestbed();
    expect((await summarizeGate({ channelId: CHANNEL, log: quiet, now: NOW })).passed).toBe(false);
  });
});
