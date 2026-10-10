import { createHash, randomUUID } from "node:crypto";
import {
  EXTRACTION_VERSION,
  FEATURE_VERSION,
  childLogger,
  logger as rootLogger,
  type Logger,
} from "@soundcheck/core";
import { FEATURE_NAMES, FEATURE_SPEC_DOCUMENT } from "@soundcheck/core/features";
import {
  isStepDone,
  latestQualityVerdict,
  markStepDone,
  replaceChannelRows,
  saveFeatureSpec,
} from "@soundcheck/core/jobs";
import { GATE_STAGE } from "../consistency/gate";
import { assembleTrainingBins, type TrainingBins } from "./assemble";
import { readFeatureInputs } from "./inputs";

export const FEATURES_STEP = "features";

export interface FeaturesResult extends Omit<TrainingBins, "rows"> {
  channelId: string;
  rows: number;
  /** The quality-gate summary that let this extraction version through. */
  gateReportId: string;
  /** False when nothing changed since the last run, so the rows were left as they were. */
  written: boolean;
}

/**
 * `soundcheck features`: rebuilds the channel's `training_bins` rows from its
 * curves, views, traffic mix and current beats, and stores the feature spec in
 * `feature_specs`. Refuses an extraction version without a passing quality
 * gate (Phase 06). Skips the write when the rows would be identical to the
 * last run's, unless forced.
 */
export async function buildFeatures({
  channelId,
  force = false,
  log = rootLogger,
  now = new Date(),
}: {
  channelId: string;
  force?: boolean;
  log?: Logger;
  now?: Date;
}): Promise<FeaturesResult> {
  const runId = randomUUID().replaceAll("-", "");
  const runLog = childLogger({ channel_id: channelId, stage: FEATURES_STEP, run_id: runId }, log);

  const verdict = await latestQualityVerdict(GATE_STAGE, EXTRACTION_VERSION);
  if (!verdict?.passed) {
    throw new Error(
      verdict
        ? `Extraction version ${EXTRACTION_VERSION} failed its latest quality gate (report ${verdict.reportId}); features are only built from a version that passed`
        : `Extraction version ${EXTRACTION_VERSION} has no quality gate result: run "soundcheck consistency runs" and "consistency gate" first`,
    );
  }

  const bins = assembleTrainingBins(channelId, await readFeatureInputs(channelId));
  const key = {
    asOf: bins.asOf ?? now.toISOString().slice(0, 10),
    version: `${FEATURE_VERSION}+${EXTRACTION_VERSION}`,
    inputs: createHash("sha256").update(JSON.stringify(bins.rows)).digest("hex").slice(0, 16),
  };
  const { rows, ...summary } = bins;
  const result = {
    ...summary,
    channelId,
    rows: rows.length,
    gateReportId: verdict.reportId,
  };
  if (!force && (await isStepDone(channelId, FEATURES_STEP, key))) {
    runLog.info({ rows: rows.length }, "features unchanged; nothing written");
    return { ...result, written: false };
  }

  await saveFeatureSpec({ version: FEATURE_VERSION, document: FEATURE_SPEC_DOCUMENT, now });
  await replaceChannelRows({ table: "training_bins", channelId, rows, runId, log: runLog });
  await markStepDone(channelId, FEATURES_STEP, { ...key, rows: { training_bins: rows.length } });
  runLog.info(
    { rows: rows.length, videos: bins.used.length, skipped: bins.skipped.length },
    "features built",
  );
  return { ...result, written: true };
}

/** A short report of a features run for the terminal. */
export function formatFeatures(result: FeaturesResult): string {
  const { context, rowsByAudience } = result;
  const lines = [
    `Features for ${result.channelId} (${FEATURE_VERSION}, beats ${EXTRACTION_VERSION}, data through ${result.asOf ?? "n/a"})`,
    `  Quality gate: passed (report ${result.gateReportId})`,
    `  Videos: ${result.used.length} used, ${result.skipped.length} skipped`,
    ...result.skipped.map(({ videoId, reason }) => `    ${videoId}: ${reason}`),
    `  Rows: ${result.rows} (all ${rowsByAudience.all}, subscribed ${rowsByAudience.subscribed}, unsubscribed ${rowsByAudience.unsubscribed}), ${FEATURE_NAMES.length} features each`,
  ];
  if (context) {
    const mix = context.mixMean;
    lines.push(
      `  Channel context: median target level ${context.medianTargetLevel}; newcomer mix mean search ${mix.search.toFixed(2)}, suggested ${mix.suggested.toFixed(2)}, browse ${mix.browse.toFixed(2)}`,
      `  Newcomer mix missing: ${result.missingMix.length === 0 ? "none" : result.missingMix.join(", ")}`,
    );
  }
  lines.push(
    result.written
      ? "  training_bins: written"
      : "  training_bins: unchanged since the last run (--force rewrites it)",
  );
  return lines.join("\n");
}
