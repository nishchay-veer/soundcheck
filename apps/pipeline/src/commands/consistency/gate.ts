import { randomUUID } from "node:crypto";
import {
  EXTRACTION_VERSION,
  childLogger,
  logger as rootLogger,
  type Logger,
} from "@soundcheck/core";
import {
  loadQualityReports,
  readQualityReports,
  saveExtractionGate,
  writeQualityReport,
} from "@soundcheck/core/jobs";
import { HUMAN_AGREEMENT_STAGE, type HumanAgreementReport } from "./human";
import { GATE, ORDINAL_FIELDS, type AgreementMetrics } from "./metrics";
import { CONSISTENCY_STAGE, type ConsistencyReport } from "./run";

export const GATE_STAGE = "extraction-quality-gate";

export interface GateIteration {
  report_id: string;
  created_at: string;
  extraction_version: string;
  passed: boolean;
  average: AgreementMetrics;
  cost_usd: number | null;
  video_minutes: number;
}

export interface GateSummary {
  report_id: string;
  created_at: string;
  /** The version the decision is about: the current EXTRACTION_VERSION. */
  extraction_version: string;
  /** Whether the latest consistency report for that version passed every threshold. */
  passed: boolean;
  thresholds: typeof GATE;
  iterations: GateIteration[];
  human: {
    report_id: string;
    method: HumanAgreementReport["method"];
    kappa: number | null;
    agreement: number;
    boundary_f1: number;
    changed_beats: number;
    labelled_beats: number;
  } | null;
  /** Every consistency and human-agreement run so far. */
  cost: { usd: number | null; video_minutes: number; usd_per_video_minute: number | null };
}

/**
 * `soundcheck consistency gate`: one summary of the quality gate from every
 * stored consistency and human-agreement report (iterations, the verdict for
 * the current extraction version, human agreement and cost), written to
 * `quality_reports` so later phases can check the version passed before
 * training on it.
 */
export async function summarizeGate({
  channelId,
  log = rootLogger,
  now = new Date(),
}: {
  channelId: string;
  log?: Logger;
  now?: Date;
}): Promise<GateSummary> {
  const reportId = randomUUID().replaceAll("-", "");
  const gateLog = childLogger({ channel_id: channelId, stage: GATE_STAGE, run_id: reportId }, log);
  const reports = await readQualityReports(channelId);

  const iterations: GateIteration[] = reports
    .filter((report) => report.stage === CONSISTENCY_STAGE)
    .map((report) => {
      const details = report.details as unknown as ConsistencyReport;
      const sweep = details.sweeps[0];
      if (!sweep) throw new Error(`Consistency report ${report.report_id} has no runs`);
      return {
        report_id: report.report_id,
        created_at: report.created_at,
        extraction_version: details.extraction_version,
        passed: details.passed,
        average: sweep.average,
        cost_usd: details.usage.cost_usd,
        video_minutes: details.usage.video_minutes,
      };
    });
  const current = iterations
    .filter((iteration) => iteration.extraction_version === EXTRACTION_VERSION)
    .at(-1);

  const humanReports = reports
    .filter((report) => report.stage === HUMAN_AGREEMENT_STAGE)
    .map((report) => report.details as unknown as HumanAgreementReport);
  const human = humanReports
    .filter((report) => report.extraction_version === EXTRACTION_VERSION)
    .at(-1);

  let usd: number | null = 0;
  let minutes = 0;
  for (const iteration of iterations) {
    usd = usd === null || iteration.cost_usd === null ? null : usd + iteration.cost_usd;
    minutes += iteration.video_minutes;
  }
  for (const report of humanReports) {
    usd = usd === null || report.cost_usd === null ? null : usd + report.cost_usd;
    minutes += report.videos.reduce((sum, video) => sum + video.durationS / 60, 0);
  }

  const summary: GateSummary = {
    report_id: reportId,
    created_at: now.toISOString(),
    extraction_version: EXTRACTION_VERSION,
    passed: current?.passed ?? false,
    thresholds: GATE,
    iterations,
    human: human
      ? {
          report_id: human.report_id,
          method: human.method,
          kappa: human.pooled.kappa,
          agreement: human.pooled.agreement,
          boundary_f1: human.pooled.boundaryF1,
          changed_beats: human.videos.reduce((sum, video) => sum + (video.changedBeats ?? 0), 0),
          labelled_beats: human.videos.reduce((sum, video) => sum + video.humanBeats, 0),
        }
      : null,
    cost: {
      usd,
      video_minutes: minutes,
      usd_per_video_minute: usd !== null && minutes > 0 ? usd / minutes : null,
    },
  };
  await writeQualityReport({
    report_id: reportId,
    channel_id: channelId,
    stage: GATE_STAGE,
    run_id: reportId,
    created_at: summary.created_at,
    details: summary as unknown as Record<string, unknown>,
  });
  await loadQualityReports(channelId, { runId: reportId, log: gateLog });
  // The verdict also goes where deleting this channel cannot remove it: every channel's build needs it.
  await saveExtractionGate({
    extractionVersion: summary.extraction_version,
    passed: summary.passed,
    reportId,
    decidedAt: now,
  });
  gateLog.info(
    { extraction_version: EXTRACTION_VERSION, passed: summary.passed },
    "quality gate summarized",
  );
  return summary;
}

const value = (v: number | null) => (v === null ? "n/a" : v.toFixed(2));

/** The iteration table and verdict, as Markdown, for the notes and the quality report. */
export function formatGateSummary(summary: GateSummary): string {
  const label = (field: string) => field.replaceAll("_", " ");
  const header = [
    "Iteration",
    "Version",
    "Boundary F1",
    "beat_type κ",
    "framing/visual κ",
    ...ORDINAL_FIELDS.map((field) => `${label(field)} wκ`),
    "Gate",
  ];
  const rows = summary.iterations.map((iteration, index) => {
    const a = iteration.average as AgreementMetrics & { framingKappa?: number | null };
    return [
      String(index),
      iteration.extraction_version,
      value(a.boundaryF1),
      value(a.beatTypeKappa),
      value(a.visualKappa ?? a.framingKappa ?? null),
      ...ORDINAL_FIELDS.map((field) => value(a.ordinal[field] ?? null)),
      iteration.passed ? "pass" : "fail",
    ];
  });
  const thresholds = [
    "Needs",
    "",
    `≥ ${GATE.boundaryF1}`,
    `≥ ${GATE.beatTypeKappa}`,
    `≥ ${GATE.visualKappa}`,
    ...ORDINAL_FIELDS.map(() => `≥ ${GATE.ordinalKappa}`),
    "",
  ];
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const human = summary.human;
  return [
    line(header),
    line(header.map(() => "---")),
    ...rows.map(line),
    line(thresholds),
    "",
    `Gate for ${summary.extraction_version}: ${summary.passed ? "PASSED" : "NOT PASSED"}.`,
    human
      ? `Human agreement (${human.method}): kappa ${value(human.kappa)}, same type ${Math.round(human.agreement * 100)}% of seconds, boundary F1 ${value(human.boundary_f1)}; ${human.changed_beats} of ${human.labelled_beats} beats changed.`
      : "Human agreement: not measured for this version.",
    `Cost of all gate runs: ${summary.cost.usd === null ? "n/a" : `$${summary.cost.usd.toFixed(2)}`} for ${summary.cost.video_minutes.toFixed(0)} minutes of video (${summary.cost.usd_per_video_minute === null ? "n/a" : `$${summary.cost.usd_per_video_minute.toFixed(4)}`} per minute).`,
  ].join("\n");
}
