import type { ExtractionSettings } from "@soundcheck/core/gemini";
import type { FakeBigQuery, FakeGenAI } from "@soundcheck/core/testing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHANNEL, NOW, ingestTestbed, quiet, resetTestbed } from "../ingest/testbed";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HUMAN_AGREEMENT_STAGE,
  beatsToCsv,
  changedRows,
  defaultLabelsDir,
  draftHumanLabels,
  formatHumanAgreement,
  parseHumanLabels,
  runHumanAgreement,
} from "./human";

describe("parseHumanLabels", () => {
  it("reads back-to-back beats with M:SS times", () => {
    expect(
      parseHumanLabels("start,end,beat_type\r\n0:00,0:23,context\n0:23,1:05, setup \n\n"),
    ).toEqual([
      { start_s: 0, end_s: 23, beat_type: "context" },
      { start_s: 23, end_s: 65, beat_type: "setup" },
    ]);
  });

  it.each([
    ["0:00,0:10,hook", /header/],
    ["start,end,beat_type", /No beats/],
    ["start,end,beat_type\n0:00,0:10,intro", /Line 2: unknown beat type "intro"/],
    ["start,end,beat_type\n0:00,10,hook", /Line 2: times must be M:SS/],
    ["start,end,beat_type\n0:05,0:10,hook", /first beat must start at 0:00/],
    [
      "start,end,beat_type\n0:00,0:10,hook\n0:12,0:20,setup",
      /Line 3: starts at 0:12, but the previous beat ends at 0:10/,
    ],
    ["start,end,beat_type\n0:00,0:10,hook\n0:10,0:10,setup", /Line 3: ends at 0:10, not after/],
    ["start,end,beat_type\n0:00,0:10,hook,extra", /expected start,end,beat_type/],
  ])("rejects %j", (csv, error) => {
    expect(() => parseHumanLabels(csv)).toThrow(error);
  });
});

describe("defaultLabelsDir", () => {
  it("finds docs/quality/human-labels above the working directory", () => {
    expect(defaultLabelsDir()).toMatch(/docs\/quality\/human-labels$/);
  });

  it("asks for --labels when there is none", () => {
    expect(() => defaultLabelsDir("/")).toThrow(/pass --labels/);
  });
});

const settings: ExtractionSettings = {
  model: "test-model",
  videoMode: "static",
  prices: { inputPerM: 0.75, outputPerM: 3.75 },
};
type Request = Parameters<FakeGenAI["models"]["generateContent"]>[0];

/** Gemini's answer: context to 0:30, then setup to the end, whatever the video. */
function geminiAnswer(request: Request) {
  const text =
    (request.contents as Array<{ parts: Array<{ text?: string }> }>)[0]?.parts.find((p) => p.text)
      ?.text ?? "";
  const lasts = /It lasts (\d+:\d{2})\./.exec(text)?.[1] ?? "1:00";
  const beat = (start: string, end: string, beat_type: string) => ({
    start,
    end,
    beat_type,
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
  return {
    text: JSON.stringify({
      schema_version: "beats-v3",
      video_summary: "A video.",
      format: "explainer",
      title_promise: "Something.",
      target_level: 2,
      payoff_time: null,
      beats: [beat("0:00", "0:30", "context"), beat("0:30", lasts, "setup")],
    }),
  };
}

describe("runHumanAgreement", () => {
  let bigquery: FakeBigQuery;
  let gemini: FakeGenAI;
  let connect: Awaited<ReturnType<typeof ingestTestbed>>["connect"];

  beforeEach(async () => {
    ({ bigquery, gemini, connect } = await ingestTestbed());
    gemini.respondWith(geminiAnswer);
  });

  afterEach(resetTestbed);

  // fixtureVid1 lasts 1:28 and fixtureVid3 3:42 in the recorded videos.list.
  const labels: Record<string, string> = {
    // Agrees with Gemini exactly.
    fixtureVid1: "start,end,beat_type\n0:00,0:30,context\n0:30,1:28,setup",
    // Disagrees for the first 30 s and moves the boundary by 10 s.
    fixtureVid3: "start,end,beat_type\n0:00,0:40,hook\n0:40,3:42,setup",
  };
  const run = () =>
    runHumanAgreement({
      channelId: CHANNEL,
      settings,
      log: quiet,
      connect,
      now: NOW,
      videos: ["fixtureVid1", "fixtureVid3"],
      readLabels: (videoId) => labels[videoId] ?? "",
      readDraft: (videoId) => drafts[videoId] ?? null,
    });
  let drafts: Record<string, string> = {};
  beforeEach(() => {
    drafts = {};
  });

  it("compares Gemini's beat types with the person's, second by second", async () => {
    const report = await run();
    expect(report.videos.map((v) => [v.videoId, v.boundaryF1])).toEqual([
      ["fixtureVid1", 1],
      ["fixtureVid3", 0],
    ]);
    expect(report.videos[0]?.kappa).toBe(1);
    // fixtureVid3: both say setup for 182 of 222 s; chance agreement (192/222)(182/222).
    const observed = 182 / 222;
    const chance = (192 / 222) * (182 / 222);
    expect(report.videos[1]?.kappa).toBeCloseTo((observed - chance) / (1 - chance), 12);
    expect(report.videos[1]?.agreement).toBeCloseTo((222 - 40) / 222, 9);
    expect(report.pooled.seconds).toBe(88 + 222);
    expect(report.confusions[0]).toEqual({ gemini: "context", human: "hook", seconds: 30 });
    expect(
      gemini.requests.every((r) => r.config?.temperature === 0 && r.config?.seed === 20261004),
    ).toBe(true);
  });

  it("says labels were independent when there is no draft", async () => {
    const report = await run();
    expect(report.method).toBe("independent");
    expect(report.videos.every((v) => v.changedBeats === null)).toBe(true);
    expect(formatHumanAgreement(report)).toMatch(/labelled independently/);
  });

  it("reports a reviewed draft and how many beats the person changed", async () => {
    drafts = {
      fixtureVid1: labels.fixtureVid1 ?? "",
      fixtureVid3: "start,end,beat_type\n0:00,0:30,context\n0:30,3:42,setup",
    };
    const report = await run();
    expect(report.method).toBe("reviewed-draft");
    expect(report.videos.map((v) => v.changedBeats)).toEqual([0, 2]);
    expect(formatHumanAgreement(report)).toMatch(/corrected Gemini's draft/);
    expect(formatHumanAgreement(report)).toMatch(/2 of 2 changed from the draft/);
  });

  it("stores the report in quality_reports", async () => {
    const report = await run();
    expect(bigquery.tables.quality_reports).toEqual([
      expect.objectContaining({ report_id: report.report_id, stage: HUMAN_AGREEMENT_STAGE }),
    ]);
    expect(formatHumanAgreement(report)).toMatch(/Both videos: kappa .* boundary F1 0\.50/);
  });

  it("fails on a bad label file before calling Gemini", async () => {
    labels.fixtureVid3 = "start,end,beat_type\n0:00,0:40,intro";
    await expect(run()).rejects.toThrow('fixtureVid3.csv: Line 2: unknown beat type "intro"');
    expect(gemini.requests).toHaveLength(0);
  });
});

describe("beatsToCsv and changedRows", () => {
  it("writes whole-second, back-to-back rows that parse back", () => {
    const csv = beatsToCsv(
      [
        { start_s: 30.4, end_s: 88, beat_type: "setup" },
        { start_s: 0.6, end_s: 30.4, beat_type: "context" },
      ],
      88,
    );
    expect(csv).toBe("start,end,beat_type\n0:00,0:30,context\n0:30,1:28,setup\n");
    expect(parseHumanLabels(csv)).toHaveLength(2);
  });

  it("counts rows the person changed or added", () => {
    const draft = parseHumanLabels("start,end,beat_type\n0:00,0:30,context\n0:30,1:28,setup");
    const edited = parseHumanLabels(
      "start,end,beat_type\n0:00,0:20,hook\n0:20,0:30,context\n0:30,1:28,setup",
    );
    expect(changedRows(draft, draft)).toBe(0);
    expect(changedRows(edited, draft)).toBe(2);
  });
});

describe("draftHumanLabels", () => {
  afterEach(resetTestbed);

  it("writes Gemini's beats and a draft copy, and never overwrites labels", async () => {
    const { gemini, connect } = await ingestTestbed();
    gemini.respondWith(geminiAnswer);
    const dir = mkdtempSync(join(tmpdir(), "human-labels-"));
    const draft = () =>
      draftHumanLabels({
        channelId: CHANNEL,
        settings,
        log: quiet,
        connect,
        now: NOW,
        labelsDir: dir,
        videos: ["fixtureVid1"],
      });

    const [video] = await draft();
    expect(video?.beats.map((b) => [b.start, b.end, b.beatType])).toEqual([
      ["0:00", "0:30", "context"],
      ["0:30", "1:28", "setup"],
    ]);
    const csv = readFileSync(join(dir, "fixtureVid1.csv"), "utf8");
    expect(csv).toBe("start,end,beat_type\n0:00,0:30,context\n0:30,1:28,setup\n");
    expect(readFileSync(join(dir, "fixtureVid1.draft.csv"), "utf8")).toBe(csv);

    writeFileSync(join(dir, "fixtureVid1.csv"), "start,end,beat_type\n0:00,1:28,hook\n");
    await expect(draft()).rejects.toThrow(/already has labels/);
    expect(gemini.requests).toHaveLength(1);
  });
});
