import { EXTRACTION_VERSION, FEATURE_VERSION } from "@soundcheck/core";
import { FEATURE_NAMES, FEATURE_SPEC_DOCUMENT } from "@soundcheck/core/features";
import { readStepMarker } from "@soundcheck/core/jobs";
import type { FakeBigQuery } from "@soundcheck/core/testing";
import { survivalLabels } from "@soundcheck/core/stats";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GATE_STAGE } from "../consistency/gate";
import { CHANNEL, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { FEATURES_STEP, buildFeatures, formatFeatures } from "./run";

const VIDEO = "fixtureVid1";
const NOW = new Date("2026-10-10T09:00:00Z");

/** Rows as the BigQuery client returns them: DATE as `{ value }`, JSON as a string. */
function seed(bigquery: FakeBigQuery) {
  const ratios = Array.from({ length: 100 }, (_, i) => 1 - 0.005 * (i + 1));
  const { sMono, hazard } = survivalLabels(ratios);
  const audiences = ["all", "subscribed", "unsubscribed", "organic"];
  const base = { channel_id: CHANNEL, video_id: VIDEO };
  Object.assign(bigquery.tables, {
    videos: [{ ...base, duration_s: 120, eligible: true }],
    retention_coverage: audiences.map((audience) => ({
      ...base,
      audience,
      status: audience === "organic" ? "skipped" : "complete",
    })),
    retention_curves: audiences
      .filter((audience) => audience !== "organic")
      .flatMap((audience) =>
        ratios.map((_, i) => ({
          ...base,
          audience,
          bin: i + 1,
          s_mono: sMono[i],
          hazard: hazard[i],
          as_of: { value: "2026-10-07" },
        })),
      ),
    video_stats: [
      { ...base, subscribed_status: "SUBSCRIBED", views: 40 },
      { ...base, subscribed_status: "UNSUBSCRIBED", views: 160 },
    ],
    video_traffic_mix: [
      { ...base, subscribed_status: "UNSUBSCRIBED", bucket: "search", share: 0.25 },
      { ...base, subscribed_status: "UNSUBSCRIBED", bucket: "search", share: 0.05 },
      { ...base, subscribed_status: "UNSUBSCRIBED", bucket: "browse", share: 0.7 },
      { ...base, subscribed_status: "SUBSCRIBED", bucket: "suggested", share: 1 },
    ],
    beat_videos: [
      {
        ...base,
        extraction_version: "beats-v4",
        format: "vlog",
        target_level: 4,
        payoff_time_s: null,
      },
      {
        ...base,
        extraction_version: EXTRACTION_VERSION,
        format: "tutorial",
        target_level: 2,
        payoff_time_s: 90,
      },
    ],
    beats: [
      beatRow(1, 60, 120, "explanation"),
      beatRow(0, 0, 60, "hook"),
      { ...beatRow(0, 0, 120, "story"), extraction_version: "beats-v4" },
    ],
  });
}

function beatRow(index: number, start: number, end: number, type: string) {
  return {
    channel_id: CHANNEL,
    video_id: VIDEO,
    extraction_version: EXTRACTION_VERSION,
    beat_index: index,
    start_s: start,
    end_s: end,
    beat_type: type,
    details: JSON.stringify({
      talking_head_share: 4,
      visual: "screen_recording",
      cuts_per_min: 3,
      on_screen_text: true,
      music: "background",
      energy: 3,
      assumed_knowledge: 2,
      info_density: 4,
      opens_loop: null,
      closes_loop: false,
      speaker_count: 1,
      transcript: "Words here.",
      summary: "A beat.",
      words_per_minute: 140,
    }),
  };
}

describe("buildFeatures", () => {
  let bigquery: FakeBigQuery;
  let verdict: { report_id: string; channel_id: string; passed: string } | null;

  beforeEach(async () => {
    ({ bigquery } = await ingestTestbed());
    seed(bigquery);
    verdict = { report_id: "gate1", channel_id: "UCtestChannelForGate0000", passed: "true" };
    bigquery.respondTo(/FROM `[^`]+\.quality_reports` WHERE stage = @stage/, (params) =>
      params.stage === GATE_STAGE && params.version === EXTRACTION_VERSION && verdict
        ? [verdict]
        : [],
    );
  });

  afterEach(resetTestbed);

  const build = (force = false) =>
    buildFeatures({ channelId: CHANNEL, force, log: quiet, now: NOW });

  it("writes 100 bins per complete audience from the current beats, and the spec once", async () => {
    const result = await build();
    expect(result).toMatchObject({
      rows: 300,
      used: [VIDEO],
      skipped: [],
      missingMix: [],
      asOf: "2026-10-07",
      gateReportId: "gate1",
      written: true,
    });
    const rows = bigquery.tables.training_bins ?? [];
    expect(rows).toHaveLength(300);
    expect(new Set(rows.map((row) => row.audience))).toEqual(
      new Set(["all", "subscribed", "unsubscribed"]),
    );
    const first = rows.find((row) => row.audience === "unsubscribed" && row.bin === 1);
    expect(first).toMatchObject({
      n_at_risk: 160,
      video_views: 160,
      feature_version: FEATURE_VERSION,
      extraction_version: EXTRACTION_VERSION,
      as_of: "2026-10-07",
    });
    expect((first?.x as number[]).length).toBe(FEATURE_NAMES.length);
    // Only the current extraction's two beats: a hook, then an explanation.
    const x = (name: string) => (first?.x as number[])[FEATURE_NAMES.indexOf(name)];
    expect(x("beat_hook")).toBe(1);
    expect(x("beat_story")).toBe(0);
    expect(x("format_tutorial")).toBe(1);
    expect(bigquery.tables.feature_contexts).toEqual([
      {
        channel_id: CHANNEL,
        feature_version: FEATURE_VERSION,
        extraction_version: EXTRACTION_VERSION,
        median_target_level: 2,
        mix_mean_search: expect.closeTo(0.3, 12),
        mix_mean_suggested: 0,
        mix_mean_browse: 0.7,
        video_ids: [VIDEO],
        as_of: "2026-10-07",
        created_at: NOW.toISOString(),
      },
    ]);
    expect(bigquery.tables.feature_specs).toEqual([
      {
        feature_version: FEATURE_VERSION,
        spec: FEATURE_SPEC_DOCUMENT,
        created_at: NOW.toISOString(),
      },
    ]);
  });

  it("skips the write when nothing changed, rewrites with force, and redoes it when beats change", async () => {
    await build();
    const loads = bigquery.loads.length;
    expect((await build()).written).toBe(false);
    expect(bigquery.loads).toHaveLength(loads);
    expect((await build(true)).written).toBe(true);
    expect(bigquery.tables.feature_specs).toHaveLength(1);

    (bigquery.tables.beats?.[0] as Record<string, unknown>).beat_type = "demonstration";
    expect((await build()).written).toBe(true);
    expect(bigquery.tables.training_bins).toHaveLength(300);
  });

  it("refuses an extraction version without a passing quality gate", async () => {
    verdict = null;
    await expect(build()).rejects.toThrow(/no quality gate result/);
    verdict = { report_id: "gate2", channel_id: CHANNEL, passed: "false" };
    await expect(build()).rejects.toThrow(/failed its latest quality gate \(report gate2\)/);
    expect(bigquery.tables.training_bins).toEqual([]);
  });

  it("prints what it used, skipped and wrote", async () => {
    bigquery.tables.videos?.push({
      channel_id: CHANNEL,
      video_id: "fixtureVid2",
      duration_s: 60,
      eligible: false,
    });
    const text = formatFeatures(await build());
    expect(text).toContain(
      `Features for ${CHANNEL} (${FEATURE_VERSION}, beats ${EXTRACTION_VERSION}, data through 2026-10-07)`,
    );
    expect(text).toContain("Videos: 1 used, 1 skipped");
    expect(text).toContain("fixtureVid2: not eligible for training");
    expect(text).toContain(
      `Rows: 300 (all 100, subscribed 100, unsubscribed 100), ${FEATURE_NAMES.length} features each`,
    );
    expect(text).toContain("newcomer mix mean search 0.30, suggested 0.00, browse 0.70");
    expect(text).toContain("training_bins: written");
  });

  it("records the step with its versions, data date and inputs fingerprint", async () => {
    await build();
    expect(await readStepMarker(CHANNEL, FEATURES_STEP)).toMatchObject({
      asOf: "2026-10-07",
      version: `${FEATURE_VERSION}+${EXTRACTION_VERSION}`,
      inputs: expect.stringMatching(/^[0-9a-f]{16}$/),
      rows: { training_bins: 300, feature_contexts: 1 },
    });
  });
});
