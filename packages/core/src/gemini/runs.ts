import { pickServerEnv } from "../env";
import { getStorage } from "../gcp";
import {
  beatRowSchema,
  beatVideoRowSchema,
  channelIdSchema,
  extractionRunRowSchema,
  type BeatRow,
  type BeatVideoRow,
  type ExtractionRunRow,
} from "../schemas";
import { EXTRACTION_VERSION } from "../versions";
import type { CachedExtraction } from "./cache";
import type { ExtractionOutcome, ExtractionSettings } from "./extract";

/**
 * Run records and BigQuery rows for beat extraction. Each `extract beats`
 * task writes one run record per video to the raw bucket, beside the cache;
 * `extract load` rebuilds the channel's rows from both, so sharded tasks never
 * overwrite each other's rows.
 */

const rawBucket = () => getStorage().bucket(pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET);
const runPrefix = (channelId: string) => `${channelIdSchema.parse(channelId)}/extraction-runs/`;

/** The `extraction_runs` row for one video in one run. */
export function extractionRunRow(
  outcome: ExtractionOutcome,
  {
    runId,
    channelId,
    settings,
  }: { runId: string; channelId: string; settings: ExtractionSettings },
): ExtractionRunRow {
  return extractionRunRowSchema.parse({
    run_id: runId,
    channel_id: channelId,
    video_id: outcome.videoId,
    extraction_version: EXTRACTION_VERSION,
    gemini_model: settings.model,
    status: outcome.status,
    started_at: outcome.startedAt.toISOString(),
    finished_at: outcome.finishedAt.toISOString(),
    details: {
      cache_key: outcome.key,
      video_mode: settings.videoMode,
      ...outcome.usage,
      errors: outcome.errors,
      calls: outcome.calls,
      beats: outcome.extraction?.beats.beats.length ?? null,
      coverage: outcome.extraction?.coverage ?? null,
    },
  });
}

/** Stores one run record at `{channel}/extraction-runs/{run}/{video}.json`. */
export async function writeRunRecord(row: ExtractionRunRow): Promise<void> {
  const record = extractionRunRowSchema.parse(row);
  if (!/^[\w-]+$/.test(record.run_id) || !/^[\w-]+$/.test(record.video_id)) {
    throw new RangeError("Invalid run or video ID");
  }
  await rawBucket()
    .file(`${runPrefix(record.channel_id)}${record.run_id}/${record.video_id}.json`)
    .save(JSON.stringify(record), { resumable: false, contentType: "application/json" });
}

/** Every run record for the channel, oldest run first. Unreadable records are skipped. */
export async function readRunRecords(channelId: string): Promise<ExtractionRunRow[]> {
  const bucket = rawBucket();
  const [files] = await bucket.getFiles({ prefix: runPrefix(channelId) });
  const records: ExtractionRunRow[] = [];
  for (const { name } of files) {
    const [contents] = await bucket.file(name).download();
    const record = extractionRunRowSchema.safeParse(JSON.parse(contents.toString("utf8")));
    if (record.success) records.push(record.data);
  }
  return records.sort((a, b) => a.started_at.localeCompare(b.started_at));
}

/** `beats` rows for one cached extraction: one per beat, features in `details`. */
export function beatRows(extraction: CachedExtraction): BeatRow[] {
  return extraction.beats.beats.map(({ start_s, end_s, beat_type, ...features }, index) =>
    beatRowSchema.parse({
      channel_id: extraction.channel_id,
      video_id: extraction.video_id,
      extraction_version: extraction.extraction_version,
      beat_index: index,
      start_s,
      end_s,
      beat_type,
      extracted_at: extraction.extracted_at,
      details: features,
    }),
  );
}

/** The `beat_videos` row for one cached extraction. */
export function beatVideoRow(extraction: CachedExtraction): BeatVideoRow {
  const { beats } = extraction;
  return beatVideoRowSchema.parse({
    channel_id: extraction.channel_id,
    video_id: extraction.video_id,
    extraction_version: extraction.extraction_version,
    cache_key: extraction.key,
    gemini_model: extraction.gemini_model,
    video_mode: extraction.video_mode,
    format: beats.format,
    video_summary: beats.video_summary,
    title_promise: beats.title_promise,
    target_level: beats.target_level,
    payoff_time_s: beats.payoff_time_s,
    beat_count: beats.beats.length,
    coverage: extraction.coverage,
    duration_s: extraction.duration_s,
    extracted_at: extraction.extracted_at,
  });
}
