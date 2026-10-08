import { randomUUID } from "node:crypto";
import {
  EXTRACTION_VERSION,
  childLogger,
  logger as rootLogger,
  type Logger,
} from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import {
  EXTRACTION_SEED,
  extractVideoBeats,
  extractionRequest,
  extractionSettings,
  type ExtractionOutcome,
  type ExtractionSettings,
  type ExtractionTarget,
} from "@soundcheck/core/gemini";
import { archiveRaw, loadQualityReports, writeQualityReport } from "@soundcheck/core/jobs";
import { parseVideos, videosRequest } from "@soundcheck/core/youtube";
import pLimit from "p-limit";
import { connectYoutube, type YoutubeApi } from "../ingest/run";
import {
  averageMetrics,
  gateChecks,
  pairMetrics,
  runsIdentical,
  topConfusions,
  type AgreementMetrics,
  type GateCheck,
  type RunExtraction,
} from "./metrics";
import { CONSISTENCY_TEST_SET, type TestVideo } from "./test-set";

export const CONSISTENCY_STAGE = "extraction-consistency";
export const DEFAULT_RUNS = 3;
/** Used when every run at temperature 0 comes back identical (spec step 1). */
export const SENSITIVITY_TEMPERATURE = 0.4;
const CONCURRENCY = 4;

export interface ConsistencyOptions {
  /** The channel running the gate: raw answers and the report are stored under it. */
  channelId: string;
  runs?: number;
  temperature?: number;
  videos?: readonly TestVideo[];
  settings?: ExtractionSettings;
  log?: Logger;
  connect?: (channelId: string, log: Logger) => Promise<YoutubeApi>;
  now?: Date;
}

export interface Sweep {
  temperature: number;
  runs: number;
  seeds: number[];
  /** Every run returned exactly the same beats for every video. */
  identical: boolean;
  pairs: Array<{ runs: [number, number]; metrics: AgreementMetrics }>;
  average: AgreementMetrics;
  gate: { passed: boolean; checks: GateCheck[] };
  confusions: {
    beat_type: Array<{ first: string; second: string; seconds: number }>;
    framing: Array<{ first: string; second: string; seconds: number }>;
  };
  /** Extractions that did not validate; their video is left out of that run's pairs. */
  failures: Array<{ videoId: string; run: number; status: string; errors: string[] }>;
}

export interface ConsistencyReport {
  report_id: string;
  created_at: string;
  extraction_version: string;
  gemini_model: string;
  video_mode: string;
  prompt_hash: string;
  videos: Array<{ id: string; kind: string; duration_s: number }>;
  sweeps: Sweep[];
  /** The gate verdict at temperature 0, the setting extraction uses. */
  passed: boolean;
  usage: {
    calls: number;
    tokens_in: number;
    tokens_out: number;
    cost_usd: number | null;
    video_minutes: number;
  };
}

/**
 * `soundcheck consistency`: extracts each test video several times, bypassing
 * and never writing the cache, with a different seed per run, and measures how
 * well the runs agree. If every run at temperature 0 is identical, it repeats
 * the runs at 0.4 to measure sensitivity. The report is stored and loaded into
 * `quality_reports`.
 */
export async function runConsistency(options: ConsistencyOptions): Promise<ConsistencyReport> {
  const { channelId } = options;
  const reportId = randomUUID().replaceAll("-", "");
  const log = childLogger(
    { channel_id: channelId, stage: CONSISTENCY_STAGE, run_id: reportId },
    options.log ?? rootLogger,
  );
  const settings = options.settings ?? extractionSettings();
  const runs = options.runs ?? DEFAULT_RUNS;
  const now = options.now ?? new Date();
  const testSet = options.videos ?? CONSISTENCY_TEST_SET;
  if (runs < 2) throw new RangeError("Consistency needs at least two runs");
  await loadChannel(channelId);

  // Lengths and privacy from the Data API; the response is archived first.
  const api = await (options.connect ?? connectYoutube)(channelId, log);
  const request = videosRequest(testSet.map((video) => video.id));
  const body = await api.videos(request);
  await archiveRaw({
    channelId,
    source: "youtube-videos",
    key: "consistency-batch-001",
    body,
    request,
    fetchedAt: now,
  });
  const found = parseVideos(body);
  const targets: ExtractionTarget[] = [];
  for (const video of testSet) {
    const metadata = found.find((v) => v.id === video.id);
    if (!metadata || metadata.privacyStatus === "private" || metadata.durationS <= 0) {
      log.warn({ video_id: video.id }, "test video unavailable; left out");
      continue;
    }
    targets.push({
      channelId,
      videoId: video.id,
      durationS: metadata.durationS,
      privacyStatus: metadata.privacyStatus,
    });
  }
  if (targets.length === 0) throw new Error("No test video is available");

  const usage = {
    calls: 0,
    tokens_in: 0,
    tokens_out: 0,
    cost: 0 as number | null,
    video_minutes: 0,
  };
  const limit = pLimit(CONCURRENCY);

  const sweep = async (temperature: number): Promise<Sweep> => {
    const seeds = Array.from({ length: runs }, (_, run) => EXTRACTION_SEED + run);
    const outcomes = await Promise.all(
      seeds.flatMap((seed, run) =>
        targets.map((target) =>
          limit(async (): Promise<[number, ExtractionTarget, ExtractionOutcome]> => {
            const outcome = await extractVideoBeats(target, {
              settings,
              noCache: true,
              writeCache: false,
              temperature,
              seed,
              archive: {
                source: "consistency",
                label: `${reportId}-t${temperature}-r${run + 1}-${target.videoId}`,
              },
              log,
            });
            return [run, target, outcome];
          }),
        ),
      ),
    );

    const byRun: RunExtraction[][] = seeds.map(() => []);
    const failures: Sweep["failures"] = [];
    for (const [run, target, outcome] of outcomes) {
      usage.calls += outcome.usage.calls;
      usage.tokens_in += outcome.usage.prompt_tokens + outcome.usage.tool_use_tokens;
      usage.tokens_out += outcome.usage.output_tokens + outcome.usage.thinking_tokens;
      usage.cost =
        usage.cost === null || outcome.usage.cost_usd === null
          ? null
          : usage.cost + outcome.usage.cost_usd;
      usage.video_minutes += target.durationS / 60;
      if (outcome.extraction) {
        byRun[run]?.push({
          videoId: target.videoId,
          durationS: target.durationS,
          beats: outcome.extraction.beats,
        });
      } else {
        failures.push({
          videoId: target.videoId,
          run: run + 1,
          status: outcome.status,
          errors: outcome.errors,
        });
      }
    }

    const pairs: Sweep["pairs"] = [];
    for (let i = 0; i < runs; i += 1) {
      for (let j = i + 1; j < runs; j += 1) {
        pairs.push({ runs: [i + 1, j + 1], metrics: pairMetrics(byRun[i] ?? [], byRun[j] ?? []) });
      }
    }
    const average = averageMetrics(pairs.map((pair) => pair.metrics));
    return {
      temperature,
      runs,
      seeds,
      identical: failures.length === 0 && runsIdentical(byRun),
      pairs,
      average,
      gate: gateChecks(average),
      confusions: {
        beat_type: topConfusions(byRun, "beat_type"),
        framing: topConfusions(byRun, "framing"),
      },
      failures,
    };
  };

  const temperature = options.temperature ?? 0;
  const sweeps = [await sweep(temperature)];
  if (temperature === 0 && sweeps[0]?.identical) {
    log.info("every run at temperature 0 was identical; measuring sensitivity at 0.4");
    sweeps.push(await sweep(SENSITIVITY_TEMPERATURE));
  }

  const report: ConsistencyReport = {
    report_id: reportId,
    created_at: now.toISOString(),
    extraction_version: EXTRACTION_VERSION,
    gemini_model: settings.model,
    video_mode: settings.videoMode,
    prompt_hash: extractionRequest(targets[0]!.videoId, settings).promptHash,
    videos: targets.map((target) => ({
      id: target.videoId,
      kind: testSet.find((video) => video.id === target.videoId)?.kind ?? "",
      duration_s: target.durationS,
    })),
    sweeps,
    passed: sweeps[0]?.gate.passed ?? false,
    usage: {
      calls: usage.calls,
      tokens_in: usage.tokens_in,
      tokens_out: usage.tokens_out,
      cost_usd: usage.cost,
      video_minutes: usage.video_minutes,
    },
  };
  await writeQualityReport({
    report_id: reportId,
    channel_id: channelId,
    stage: CONSISTENCY_STAGE,
    run_id: reportId,
    created_at: report.created_at,
    details: report as unknown as Record<string, unknown>,
  });
  await loadQualityReports(channelId, { runId: reportId, log });
  log.info({ passed: report.passed, usage: report.usage }, "consistency measured");
  return report;
}

const number = (value: number | null, digits = 2) =>
  value === null ? "n/a" : value.toFixed(digits);

/** The report `soundcheck consistency` prints. */
export function formatConsistency(report: ConsistencyReport): string {
  const lines = [
    `Extraction consistency, report ${report.report_id}`,
    `  ${report.extraction_version}, ${report.gemini_model}, ${report.video_mode}; ${report.videos.length} videos: ${report.videos
      .map(
        (v) =>
          `${v.kind} ${Math.floor(v.duration_s / 60)}:${String(v.duration_s % 60).padStart(2, "0")}`,
      )
      .join(", ")}`,
  ];
  for (const sweep of report.sweeps) {
    lines.push(
      "",
      `  Temperature ${sweep.temperature}, ${sweep.runs} runs (seeds ${sweep.seeds.join(", ")})${sweep.identical ? ": every run identical" : ""}`,
    );
    for (const check of sweep.gate.checks) {
      const verdict = check.value === null ? "n/a " : check.passed ? "PASS" : "FAIL";
      lines.push(
        `    ${verdict}  ${check.metric.padEnd(30)} ${number(check.value).padStart(6)}   (needs ${check.threshold.toFixed(2)})`,
      );
    }
    const payoff = sweep.average.payoff;
    lines.push(
      `          payoff time difference         ${payoff.meanAbsS === null ? "n/a" : `${payoff.meanAbsS.toFixed(1)} s`}   (${payoff.compared} compared, ${payoff.oneMissing} where only one run had a payoff)`,
    );
    for (const field of ["beat_type", "framing"] as const) {
      const confusions = sweep.confusions[field].slice(0, 5);
      if (confusions.length > 0) {
        lines.push(
          `    Most confused ${field}: ${confusions.map((c) => `${c.first}/${c.second} ${c.seconds} s`).join(", ")}`,
        );
      }
    }
    for (const failure of sweep.failures) {
      lines.push(
        `    run ${failure.run}, ${failure.videoId}: ${failure.status} (${failure.errors[0] ?? ""})`,
      );
    }
  }
  lines.push(
    "",
    `  Gate at temperature 0: ${report.passed ? "PASSED" : "FAILED"}`,
    `  ${report.usage.calls} Gemini calls, ${report.usage.tokens_in} tokens in, ${report.usage.tokens_out} out, cost ${report.usage.cost_usd === null ? "n/a" : `$${report.usage.cost_usd.toFixed(2)}`} for ${report.usage.video_minutes.toFixed(1)} minutes of video`,
  );
  return lines.join("\n");
}
