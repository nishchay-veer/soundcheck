import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
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
  extractionSettings,
  formatClock,
  type ExtractionSettings,
} from "@soundcheck/core/gemini";
import { archiveRaw, loadQualityReports, writeQualityReport } from "@soundcheck/core/jobs";
import { beatTypeSchema, clockToSeconds, type BeatType } from "@soundcheck/core/schemas";
import {
  bothLabelled,
  boundaryF1,
  cohenKappa,
  confusionMatrix,
  internalBoundaries,
  perSecond,
  type Span,
} from "@soundcheck/core/stats";
import { parseVideos, videosRequest } from "@soundcheck/core/youtube";
import { connectYoutube, type YoutubeApi } from "../ingest/run";
import { BOUNDARY_TOLERANCE_S } from "./metrics";

export const HUMAN_AGREEMENT_STAGE = "extraction-human-agreement";
/** The videos labelled by hand (Phase 06), with their CSV files in `docs/quality/human-labels/`. */
export const HUMAN_LABELLED_VIDEOS = ["S9H3sqKc9Y4", "RwkGSPp6yG0"] as const;

/** `docs/quality/human-labels`, found by walking up from the working directory. */
export function defaultLabelsDir(from: string = process.cwd()): string {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "docs", "quality", "human-labels");
    if (existsSync(candidate)) return candidate;
    if (dirname(dir) === dir)
      throw new Error("docs/quality/human-labels not found; pass --labels <dir>");
  }
}

export interface HumanBeat extends Span {
  beat_type: BeatType;
}

/**
 * Parses a hand-labelled CSV: a `start,end,beat_type` header, then one beat
 * per row with `M:SS` times. Rows must be in order, back to back, and each
 * type must be one Gemini can give. Throws with the line number on any error.
 */
export function parseHumanLabels(csv: string): HumanBeat[] {
  const lines = csv
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines[0]?.replaceAll(" ", "") !== "start,end,beat_type") {
    throw new Error('Line 1 must be the header "start,end,beat_type"');
  }
  const beats: HumanBeat[] = [];
  for (const [index, line] of lines.slice(1).entries()) {
    const where = `Line ${index + 2}`;
    const [start, end, type, ...extra] = line.split(",").map((cell) => cell.trim());
    if (!start || !end || !type || extra.length > 0)
      throw new Error(`${where}: expected start,end,beat_type`);
    let start_s: number;
    let end_s: number;
    try {
      start_s = clockToSeconds(start);
      end_s = clockToSeconds(end);
    } catch {
      throw new Error(`${where}: times must be M:SS, got "${start}" and "${end}"`);
    }
    const parsed = beatTypeSchema.safeParse(type);
    if (!parsed.success) throw new Error(`${where}: unknown beat type "${type}"`);
    if (end_s <= start_s)
      throw new Error(`${where}: ends at ${end}, not after it starts at ${start}`);
    const previous = beats[beats.length - 1];
    if (!previous && start_s !== 0) throw new Error(`${where}: the first beat must start at 0:00`);
    if (previous && start_s !== previous.end_s) {
      throw new Error(
        `${where}: starts at ${start}, but the previous beat ends at ${lines[index]?.split(",")[1]?.trim()}`,
      );
    }
    beats.push({ start_s, end_s, beat_type: parsed.data });
  }
  if (beats.length === 0) throw new Error("No beats: add one row per beat under the header");
  return beats;
}

export interface VideoAgreement {
  videoId: string;
  durationS: number;
  kappa: number | null;
  /** Share of seconds where Gemini and the person chose the same type. */
  agreement: number;
  boundaryF1: number;
  humanBeats: number;
  geminiBeats: number;
  /** With a reviewed draft: beats the person changed (type or times) or added. */
  changedBeats: number | null;
}

export interface HumanAgreementReport {
  report_id: string;
  created_at: string;
  extraction_version: string;
  gemini_model: string;
  /**
   * `independent`: labelled without seeing Gemini's output. `reviewed-draft`:
   * the person corrected Gemini's draft, which biases agreement upward.
   */
  method: "independent" | "reviewed-draft";
  videos: VideoAgreement[];
  /** Over both videos' seconds together. */
  pooled: { kappa: number | null; agreement: number; boundaryF1: number; seconds: number };
  /** Where Gemini (first) and the person (second) disagree most, in seconds. */
  confusions: Array<{ gemini: string; human: string; seconds: number }>;
  cost_usd: number | null;
}

export interface HumanAgreementOptions {
  channelId: string;
  /** Directory with `{videoId}.csv`; defaults to `docs/quality/human-labels` above the working directory. */
  labelsDir?: string;
  settings?: ExtractionSettings;
  log?: Logger;
  connect?: (channelId: string, log: Logger) => Promise<YoutubeApi>;
  readLabels?: (videoId: string) => string;
  /** Gemini's draft for a video (`{videoId}.draft.csv`), or null when labelled independently. */
  readDraft?: (videoId: string) => string | null;
  /** The labelled videos; defaults to `HUMAN_LABELLED_VIDEOS`. */
  videos?: readonly string[];
  now?: Date;
}

/** Beats as CSV rows with whole-second `M:SS` times, back to back from 0:00 to the end. */
export function beatsToCsv(
  beats: ReadonlyArray<Span & { beat_type: string }>,
  durationS: number,
): string {
  const sorted = [...beats].sort((a, b) => a.start_s - b.start_s);
  const starts = sorted.map((beat, i) => (i === 0 ? 0 : Math.round(beat.start_s)));
  const rows = sorted.map((beat, i) => {
    const end = i + 1 < sorted.length ? (starts[i + 1] as number) : Math.round(durationS);
    return `${formatClock(starts[i] as number)},${formatClock(end)},${beat.beat_type}`;
  });
  return `start,end,beat_type\n${rows.join("\n")}\n`;
}

/** Rows of `labels` that are not in `draft` exactly (same start, end and type). */
export function changedRows(labels: readonly HumanBeat[], draft: readonly HumanBeat[]): number {
  const key = (beat: HumanBeat) => `${beat.start_s}|${beat.end_s}|${beat.beat_type}`;
  const drafted = new Set(draft.map(key));
  return labels.filter((beat) => !drafted.has(key(beat))).length;
}

export interface DraftedVideo {
  videoId: string;
  durationS: number;
  beats: Array<{ start: string; end: string; beatType: string; summary: string }>;
}

/**
 * `soundcheck consistency human --draft`: writes Gemini's beats (current
 * prompt, temperature 0, production seed) into each `{videoId}.csv` for a
 * person to correct, keeping a `{videoId}.draft.csv` copy so the comparison
 * can report how much was changed. Never overwrites labels already written.
 */
export async function draftHumanLabels(
  options: Omit<HumanAgreementOptions, "readLabels" | "readDraft"> & { force?: boolean },
): Promise<DraftedVideo[]> {
  const { channelId } = options;
  const log = childLogger(
    { channel_id: channelId, stage: HUMAN_AGREEMENT_STAGE },
    options.log ?? rootLogger,
  );
  const settings = options.settings ?? extractionSettings();
  const labelsDir = options.labelsDir ?? defaultLabelsDir();
  const ids = options.videos ?? HUMAN_LABELLED_VIDEOS;
  await loadChannel(channelId);
  for (const videoId of ids) {
    const file = `${labelsDir}/${videoId}.csv`;
    const existing = existsSync(file) ? readFileSync(file, "utf8").trim().split(/\r?\n/).length : 0;
    if (existing > 1 && !options.force) {
      throw new Error(
        `${videoId}.csv already has labels; remove them or pass --force to replace them`,
      );
    }
  }

  const api = await (options.connect ?? connectYoutube)(channelId, log);
  const request = videosRequest([...ids]);
  const body = await api.videos(request);
  await archiveRaw({
    channelId,
    source: "youtube-videos",
    key: "human-draft-batch-001",
    body,
    request,
    fetchedAt: options.now ?? new Date(),
  });
  const metadata = parseVideos(body);
  const drafted: DraftedVideo[] = [];
  for (const videoId of ids) {
    const video = metadata.find((v) => v.id === videoId);
    if (!video) throw new Error(`Video ${videoId} is not available`);
    const outcome = await extractVideoBeats(
      { channelId, videoId, durationS: video.durationS, privacyStatus: video.privacyStatus },
      {
        settings,
        noCache: true,
        writeCache: false,
        temperature: 0,
        seed: EXTRACTION_SEED,
        archive: { source: "consistency", label: `human-draft-${videoId}` },
        log,
      },
    );
    if (!outcome.extraction)
      throw new Error(`Extraction of ${videoId} ${outcome.status}: ${outcome.errors[0] ?? ""}`);
    const beats = outcome.extraction.beats.beats;
    const csv = beatsToCsv(beats, video.durationS);
    writeFileSync(`${labelsDir}/${videoId}.csv`, csv);
    writeFileSync(`${labelsDir}/${videoId}.draft.csv`, csv);
    const rows = parseHumanLabels(csv);
    drafted.push({
      videoId,
      durationS: video.durationS,
      beats: rows.map((row, i) => ({
        start: formatClock(row.start_s),
        end: formatClock(row.end_s),
        beatType: row.beat_type,
        summary: beats[i]?.summary ?? "",
      })),
    });
  }
  return drafted;
}

/**
 * `soundcheck consistency human`: extracts the hand-labelled videos with the
 * current prompt (temperature 0, the production seed, without touching the
 * cache) and compares Gemini's beat types with the person's, second by
 * second. The report goes to `quality_reports`.
 */
export async function runHumanAgreement(
  options: HumanAgreementOptions,
): Promise<HumanAgreementReport> {
  const { channelId } = options;
  const reportId = randomUUID().replaceAll("-", "");
  const log = childLogger(
    { channel_id: channelId, stage: HUMAN_AGREEMENT_STAGE, run_id: reportId },
    options.log ?? rootLogger,
  );
  const settings = options.settings ?? extractionSettings();
  const now = options.now ?? new Date();
  const labelsDir = options.labelsDir ?? defaultLabelsDir();
  const readLabels =
    options.readLabels ??
    ((videoId: string) => readFileSync(`${labelsDir}/${videoId}.csv`, "utf8"));
  const readDraft =
    options.readDraft ??
    ((videoId: string) => {
      const file = `${labelsDir}/${videoId}.draft.csv`;
      return existsSync(file) ? readFileSync(file, "utf8") : null;
    });
  await loadChannel(channelId);

  // Parse every file first, so a typo fails before any money is spent.
  const ids = options.videos ?? HUMAN_LABELLED_VIDEOS;
  const drafts = new Map(
    ids.map((videoId) => {
      const draft = readDraft(videoId);
      return [videoId, draft === null ? null : parseHumanLabels(draft)] as const;
    }),
  );
  const human = new Map(
    ids.map((videoId) => {
      try {
        return [videoId, parseHumanLabels(readLabels(videoId))] as const;
      } catch (error) {
        throw new Error(`${videoId}.csv: ${(error as Error).message}`, { cause: error });
      }
    }),
  );

  const api = await (options.connect ?? connectYoutube)(channelId, log);
  const request = videosRequest([...ids]);
  const body = await api.videos(request);
  await archiveRaw({
    channelId,
    source: "youtube-videos",
    key: "human-agreement-batch-001",
    body,
    request,
    fetchedAt: now,
  });
  const metadata = parseVideos(body);

  const videos: VideoAgreement[] = [];
  const pooledGemini: string[] = [];
  const pooledHuman: string[] = [];
  let matched = 0;
  let boundaries = 0;
  let cost: number | null = 0;
  for (const videoId of ids) {
    const video = metadata.find((v) => v.id === videoId);
    if (!video) throw new Error(`Video ${videoId} is not available`);
    const outcome = await extractVideoBeats(
      { channelId, videoId, durationS: video.durationS, privacyStatus: video.privacyStatus },
      {
        settings,
        noCache: true,
        writeCache: false,
        temperature: 0,
        seed: EXTRACTION_SEED,
        archive: { source: "consistency", label: `${reportId}-human-${videoId}` },
        log,
      },
    );
    cost = cost === null || outcome.usage.cost_usd === null ? null : cost + outcome.usage.cost_usd;
    if (!outcome.extraction)
      throw new Error(`Extraction of ${videoId} ${outcome.status}: ${outcome.errors[0] ?? ""}`);

    const geminiBeats = outcome.extraction.beats.beats;
    const humanBeats = human.get(videoId) ?? [];
    const duration = video.durationS;
    const [g, h] = bothLabelled(
      perSecond(geminiBeats, duration, (beat) => beat.beat_type as string),
      perSecond(humanBeats, duration, (beat) => beat.beat_type as string),
    );
    pooledGemini.push(...g);
    pooledHuman.push(...h);
    const f1 = boundaryF1(
      internalBoundaries(geminiBeats),
      internalBoundaries(humanBeats),
      BOUNDARY_TOLERANCE_S,
    );
    matched += f1.matched;
    boundaries += f1.first + f1.second;
    videos.push({
      videoId,
      durationS: duration,
      kappa: g.length > 0 ? cohenKappa(g, h) : null,
      agreement: g.length > 0 ? g.filter((label, i) => label === h[i]).length / g.length : 0,
      boundaryF1: f1.f1,
      humanBeats: humanBeats.length,
      geminiBeats: geminiBeats.length,
      changedBeats: drafts.get(videoId) ? changedRows(humanBeats, drafts.get(videoId) ?? []) : null,
    });
  }

  const confusions: HumanAgreementReport["confusions"] = [];
  if (pooledGemini.length > 0) {
    for (const [gemini, row] of confusionMatrix(pooledGemini, pooledHuman)) {
      for (const [person, seconds] of row)
        if (gemini !== person) confusions.push({ gemini, human: person, seconds });
    }
  }
  confusions.sort((a, b) => b.seconds - a.seconds);

  const report: HumanAgreementReport = {
    report_id: reportId,
    created_at: now.toISOString(),
    extraction_version: EXTRACTION_VERSION,
    gemini_model: settings.model,
    method: [...drafts.values()].some((draft) => draft !== null) ? "reviewed-draft" : "independent",
    videos,
    pooled: {
      kappa: pooledGemini.length > 0 ? cohenKappa(pooledGemini, pooledHuman) : null,
      agreement:
        pooledGemini.length > 0
          ? pooledGemini.filter((label, i) => label === pooledHuman[i]).length / pooledGemini.length
          : 0,
      boundaryF1: boundaries === 0 ? 1 : (2 * matched) / boundaries,
      seconds: pooledGemini.length,
    },
    confusions: confusions.slice(0, 8),
    cost_usd: cost,
  };
  await writeQualityReport({
    report_id: reportId,
    channel_id: channelId,
    stage: HUMAN_AGREEMENT_STAGE,
    run_id: reportId,
    created_at: report.created_at,
    details: report as unknown as Record<string, unknown>,
  });
  await loadQualityReports(channelId, { runId: reportId, log });
  log.info({ pooled: report.pooled }, "human agreement measured");
  return report;
}

const fixed = (value: number | null) => (value === null ? "n/a" : value.toFixed(2));

/** The report `soundcheck consistency human` prints. */
export function formatHumanAgreement(report: HumanAgreementReport): string {
  return [
    `Gemini versus human beat types, report ${report.report_id} (${report.extraction_version}, ${report.gemini_model})`,
    report.method === "reviewed-draft"
      ? "  Method: a person corrected Gemini's draft (agreement is biased upward; see changed beats)"
      : "  Method: labelled independently, without seeing Gemini's output",
    ...report.videos.map(
      (v) =>
        `  ${v.videoId}: kappa ${fixed(v.kappa)}, same type ${Math.round(v.agreement * 100)}% of seconds, ` +
        `boundary F1 ${fixed(v.boundaryF1)} (human ${v.humanBeats} beats, Gemini ${v.geminiBeats}` +
        `${v.changedBeats === null ? "" : `; ${v.changedBeats} of ${v.humanBeats} changed from the draft`})`,
    ),
    `  Both videos: kappa ${fixed(report.pooled.kappa)}, same type ${Math.round(report.pooled.agreement * 100)}% of ${report.pooled.seconds} s, boundary F1 ${fixed(report.pooled.boundaryF1)}`,
    ...(report.confusions.length > 0
      ? [
          `  Biggest disagreements (Gemini / human): ${report.confusions
            .slice(0, 5)
            .map((c) => `${c.gemini}/${c.human} ${c.seconds} s`)
            .join(", ")}`,
        ]
      : []),
    `  Cost ${report.cost_usd === null ? "n/a" : `$${report.cost_usd.toFixed(3)}`}`,
  ].join("\n");
}
