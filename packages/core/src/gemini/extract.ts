import {
  MediaProcessing,
  type Content,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import type { Logger } from "pino";
import { pickServerEnv } from "../env";
import { getGenAI } from "../gcp";
import { archiveRaw } from "../jobs/archive";
import { childLogger, logger as rootLogger } from "../logger";
import { beatExtractionPrompt } from "../prompts";
import { withRetry } from "../retry";
import { geminiResponseJsonSchema, type ExtractionStatus, type VideoBeats } from "../schemas";
import { EXTRACTION_VERSION } from "../versions";
import {
  extractionCacheKey,
  promptHash,
  readCachedExtraction,
  writeCachedExtraction,
  type CachedExtraction,
  type ExtractionUsage,
} from "./cache";
import { extractionWindows, stitchWindows, toVideoTime, type ExtractionWindow } from "./stitch";
import { checkBeats, formatClock, validateBeats } from "./validate-beats";

/** Fixed so reruns ask the same question the same way; temperature 0 still is not a guarantee. */
export const EXTRACTION_SEED = 20261004;
/** The first answer, then one retry with the validation errors appended. */
export const ANSWERS_PER_WINDOW = 2;

export type VideoMode = "static" | "agentic";

export interface ExtractionSettings {
  model: string;
  videoMode: VideoMode;
  /** US$ per million tokens; cost estimates are null without them. */
  prices: { inputPerM?: number; outputPerM?: number };
}

/** Model, video mode and prices from the environment. */
export function extractionSettings(): ExtractionSettings {
  const env = pickServerEnv([
    "GEMINI_MODEL",
    "GEMINI_VIDEO_MODE",
    "GEMINI_PRICE_INPUT_PER_M",
    "GEMINI_PRICE_OUTPUT_PER_M",
  ]);
  return {
    model: env.GEMINI_MODEL,
    videoMode: env.GEMINI_VIDEO_MODE,
    prices: { inputPerM: env.GEMINI_PRICE_INPUT_PER_M, outputPerM: env.GEMINI_PRICE_OUTPUT_PER_M },
  };
}

export const youtubeUrl = (videoId: string): string => `https://www.youtube.com/watch?v=${videoId}`;

/** The prompt, response schema, prompt hash and cache key for one video under these settings. */
export function extractionRequest(videoId: string, settings: ExtractionSettings) {
  const systemInstruction = beatExtractionPrompt();
  const responseSchema = geminiResponseJsonSchema();
  const hash = promptHash(systemInstruction, responseSchema);
  const sourceUri = youtubeUrl(videoId);
  const key = extractionCacheKey({
    sourceUri,
    extractionVersion: EXTRACTION_VERSION,
    modelId: settings.model,
    promptHash: hash,
    videoMode: settings.videoMode,
  });
  return { systemInstruction, responseSchema, promptHash: hash, sourceUri, key };
}

export interface ExtractionTarget {
  channelId: string;
  videoId: string;
  durationS: number;
  /** From `videos.list`; Gemini cannot read private videos from YouTube. */
  privacyStatus: string | null;
}

/** One Gemini call, for `extraction_runs.details`. */
export interface GeminiCallRecord {
  window: number;
  answer: number;
  prompt_tokens: number;
  output_tokens: number;
  thinking_tokens: number;
  tool_use_tokens: number;
  latency_ms: number;
  valid: boolean;
  errors: string[];
}

export interface ExtractionOutcome {
  videoId: string;
  status: ExtractionStatus;
  key: string;
  startedAt: Date;
  finishedAt: Date;
  /** The validated beats, for `extracted` and `cached`. */
  extraction: CachedExtraction | null;
  errors: string[];
  usage: ExtractionUsage;
  calls: GeminiCallRecord[];
}

const emptyUsage = (): ExtractionUsage => ({
  calls: 0,
  prompt_tokens: 0,
  output_tokens: 0,
  thinking_tokens: 0,
  tool_use_tokens: 0,
  latency_ms: 0,
  cost_usd: null,
});

/** Input (prompt and tool use) and output (answer and thinking) tokens at the configured prices. */
export function estimateCost(
  usage: ExtractionUsage,
  prices: ExtractionSettings["prices"],
): number | null {
  if (prices.inputPerM === undefined || prices.outputPerM === undefined) return null;
  const input = usage.prompt_tokens + usage.tool_use_tokens;
  const output = usage.output_tokens + usage.thinking_tokens;
  return (input * prices.inputPerM + output * prices.outputPerM) / 1_000_000;
}

/** The API's own message for a failed call. */
function errorMessage(error: unknown): string {
  const { status, message } = error as { status?: number; message?: string };
  return `${status ? `HTTP ${status}: ` : ""}${message ?? String(error)}`;
}

/** The video part and the instruction for one window. */
function windowContents(
  sourceUri: string,
  window: ExtractionWindow,
  durationS: number,
  videoMode: VideoMode,
): Content {
  const whole = window.startS === 0 && window.endS === durationS;
  const video: Part = {
    fileData: { fileUri: sourceUri, mimeType: "video/*" },
    mediaProcessing: videoMode === "agentic" ? MediaProcessing.AGENTIC : MediaProcessing.STATIC,
    ...(whole
      ? {}
      : { videoMetadata: { startOffset: `${window.startS}s`, endOffset: `${window.endS}s` } }),
  };
  const text = whole
    ? `Annotate this video. It lasts ${formatClock(durationS)}.`
    : `This is the part of a longer video from ${formatClock(window.startS)} to ${formatClock(window.endS)}. ` +
      `Annotate only this part. Give timestamps from the start of this part: "0:00" is ` +
      `${formatClock(window.startS)} in the video, and the part lasts ${formatClock(window.endS - window.startS)}.`;
  return { role: "user", parts: [video, { text }] };
}

/**
 * Extracts one video's beats, or returns the cached extraction. Each window
 * (the whole video unless it is over 40 minutes) gets one Gemini call; an
 * answer that fails validation is retried once with the specific errors. Every
 * raw answer is archived before it is parsed (rule 6). A validated result is
 * cached, so a re-run costs no tokens.
 */
export interface ExtractOptions {
  settings?: ExtractionSettings;
  /** Skip the cache lookup and ask Gemini. */
  noCache?: boolean;
  /** Store a validated result in the cache (default). Consistency runs do not. */
  writeCache?: boolean;
  /** Default 0. Consistency runs raise it to measure sensitivity. */
  temperature?: number;
  /** Default `EXTRACTION_SEED`. */
  seed?: number;
  /**
   * Where raw answers are archived: `{source}/{label}-w{window}-a{answer}/`.
   * Defaults to `gemini-beats` and the video ID.
   */
  archive?: { source: string; label: string };
  log?: Logger;
}

export async function extractVideoBeats(
  target: ExtractionTarget,
  {
    settings = extractionSettings(),
    noCache = false,
    writeCache = true,
    temperature = 0,
    seed = EXTRACTION_SEED,
    archive = { source: "gemini-beats", label: target.videoId },
    log = rootLogger,
  }: ExtractOptions = {},
): Promise<ExtractionOutcome> {
  const { channelId, videoId, durationS } = target;
  const request = extractionRequest(videoId, settings);
  const videoLog = childLogger({ channel_id: channelId, video_id: videoId }, log);
  const startedAt = new Date();
  const usage = emptyUsage();
  const calls: GeminiCallRecord[] = [];
  const outcome = (
    status: ExtractionStatus,
    extraction: CachedExtraction | null,
    errors: string[] = [],
  ): ExtractionOutcome => ({
    videoId,
    status,
    key: request.key,
    startedAt,
    finishedAt: new Date(),
    extraction,
    errors,
    usage: { ...usage, cost_usd: estimateCost(usage, settings.prices) },
    calls,
  });

  if (target.privacyStatus === "private") {
    return outcome("private_unavailable", null, ["Private videos cannot be read from YouTube."]);
  }
  if (!noCache) {
    const cached = await readCachedExtraction(channelId, videoId, request.key);
    if (cached) return outcome("cached", cached);
  }

  const parts: Array<{ window: ExtractionWindow; beats: VideoBeats }> = [];
  let coverage = 1;
  for (const window of extractionWindows(durationS)) {
    const contents: Content[] = [
      windowContents(request.sourceUri, window, durationS, settings.videoMode),
    ];
    const windowS = window.endS - window.startS;
    let errors: string[] = [];
    for (let answer = 1; answer <= ANSWERS_PER_WINDOW; answer += 1) {
      const callStarted = Date.now();
      let response: GenerateContentResponse;
      try {
        response = await withRetry(
          () =>
            getGenAI().models.generateContent({
              model: settings.model,
              contents,
              config: {
                systemInstruction: request.systemInstruction,
                temperature,
                seed,
                responseMimeType: "application/json",
                responseJsonSchema: request.responseSchema,
              },
            }),
          { operation: "vertex.generateContent(extract-beats)", logger: videoLog },
        );
      } catch (error) {
        usage.latency_ms += Date.now() - callStarted;
        return outcome("failed", null, [errorMessage(error)]);
      }

      const text = response.text ?? "";
      await archiveRaw({
        channelId,
        source: archive.source,
        key: `${archive.label}-w${window.index}-a${answer}`,
        body: { text, usageMetadata: response.usageMetadata, modelVersion: response.modelVersion },
        request: {
          model: settings.model,
          videoMode: settings.videoMode,
          temperature,
          seed,
          window,
          answer,
          key: request.key,
        },
        fetchedAt: startedAt,
      });
      const tokens = response.usageMetadata;
      const record: GeminiCallRecord = {
        window: window.index,
        answer,
        prompt_tokens: tokens?.promptTokenCount ?? 0,
        output_tokens: tokens?.candidatesTokenCount ?? 0,
        thinking_tokens: tokens?.thoughtsTokenCount ?? 0,
        tool_use_tokens: tokens?.toolUsePromptTokenCount ?? 0,
        latency_ms: Date.now() - callStarted,
        valid: false,
        errors: [],
      };
      usage.calls += 1;
      usage.prompt_tokens += record.prompt_tokens;
      usage.output_tokens += record.output_tokens;
      usage.thinking_tokens += record.thinking_tokens;
      usage.tool_use_tokens += record.tool_use_tokens;
      usage.latency_ms += record.latency_ms;

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = undefined;
      }
      const validation =
        parsed === undefined
          ? { ok: false as const, errors: ["Your output is not valid JSON."] }
          : validateBeats(parsed, windowS);
      calls.push({
        ...record,
        valid: validation.ok,
        errors: validation.ok ? [] : validation.errors,
      });
      if (validation.ok) {
        if (validation.fixes.length > 0)
          videoLog.info({ fixes: validation.fixes }, "beats repaired");
        parts.push({ window, beats: toVideoTime(window, validation.beats) });
        coverage = Math.min(coverage, validation.coverage);
        errors = [];
        break;
      }
      errors = validation.errors;
      videoLog.warn({ errors, answer }, "beats failed validation");
      contents.push(
        { role: "model", parts: [{ text }] },
        {
          role: "user",
          parts: [
            {
              text: `Your answer has these problems:\n${errors.map((e) => `- ${e}`).join("\n")}\nReturn the whole corrected JSON.`,
            },
          ],
        },
      );
    }
    if (errors.length > 0) return outcome("invalid", null, errors);
  }

  let beats: VideoBeats;
  if (parts.length === 1) {
    beats = (parts[0] as { beats: VideoBeats }).beats;
  } else {
    const stitched = checkBeats(stitchWindows(parts), durationS);
    if (!stitched.ok) return outcome("invalid", null, stitched.errors);
    beats = stitched.beats;
    coverage = stitched.coverage;
  }

  const extraction: CachedExtraction = {
    key: request.key,
    channel_id: channelId,
    video_id: videoId,
    source_uri: request.sourceUri,
    extraction_version: EXTRACTION_VERSION,
    gemini_model: settings.model,
    video_mode: settings.videoMode,
    prompt_hash: request.promptHash,
    duration_s: durationS,
    coverage,
    extracted_at: new Date().toISOString(),
    usage: { ...usage, cost_usd: estimateCost(usage, settings.prices) },
    beats,
  };
  if (writeCache) await writeCachedExtraction(extraction);
  return outcome("extracted", extraction);
}
