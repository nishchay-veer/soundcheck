import { MediaProcessing, type Content } from "@google/genai";
import { z } from "zod";
import { pickServerEnv } from "../env";
import { getGenAI, getStorage } from "../gcp";
import { archiveRaw } from "../jobs/archive";
import { childLogger, logger as rootLogger, type Logger } from "../logger";
import {
  BASELINE_PROMPT_VERSION,
  baselineRetentionPrompt,
  baselineRetentionRequest,
} from "../prompts/baseline-retention";
import { withRetry } from "../retry";
import { baselineLlmCurveRowSchema, channelIdSchema, type BaselineLlmCurveRow } from "../schemas";
import { extractionCacheKey, promptHash } from "./cache";
import {
  EXTRACTION_SEED,
  errorMessage,
  estimateCost,
  extractionSettings,
  youtubeUrl,
  type ExtractionSettings,
} from "./extract";
import { formatClock } from "./validate-beats";

/**
 * The generic-LLM baseline (Phase 09, B1): Gemini's guess at a video's
 * retention curve for a typical YouTube audience, with no channel data.
 */

const POINTS = 20;

/** Gemini's answer: share still watching at 5%, 10% … 100% of the video. */
export const geminiRetentionSchema = z.object({
  retention: z
    .array(z.number().min(0).max(1))
    .length(POINTS)
    .describe("Share of starting viewers still watching at 5%, 10%, ... 100% of the video"),
});

export function geminiRetentionJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(geminiRetentionSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/**
 * The 20 points made non-increasing (a running minimum) and interpolated
 * linearly to the end of each of the 100 bins, starting from 1 at time zero.
 */
export function interpolateRetention(points: readonly number[]): {
  curve: number[];
  points: number[];
  repaired: boolean;
} {
  if (points.length !== POINTS) throw new RangeError(`Need ${POINTS} points, got ${points.length}`);
  let lowest = 1;
  const monotone = points.map((value) => (lowest = Math.min(lowest, Math.max(0, value))));
  const repaired = monotone.some((value, i) => value !== points[i]);
  const knots = [1, ...monotone]; // at 0%, 5%, 10% … 100%
  const curve = Array.from({ length: 100 }, (_, bin) => {
    const position = ((bin + 1) / 100) * POINTS; // in 5% steps
    const below = Math.floor(position);
    const above = Math.min(below + 1, POINTS);
    const low = knots[below] as number;
    return low + (position - below) * ((knots[above] as number) - low);
  });
  return { curve, points: monotone, repaired };
}

export interface BaselineTarget {
  channelId: string;
  videoId: string;
  durationS: number;
}

export interface BaselineOutcome {
  videoId: string;
  status: "predicted" | "cached" | "invalid" | "failed";
  row: BaselineLlmCurveRow | null;
  errors: string[];
}

const cacheName = (channelId: string, key: string) =>
  `${channelIdSchema.parse(channelId)}/baseline-llm/${key}.json`;
const rawBucket = () => getStorage().bucket(pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET);

/** The cached curve, or null on a miss or an unreadable entry (predicted again then). */
async function readCached(file: {
  download: () => Promise<readonly [Buffer]>;
}): Promise<BaselineLlmCurveRow | null> {
  let text: string;
  try {
    const [contents] = await file.download();
    text = contents.toString("utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === 404) return null;
    throw error;
  }
  try {
    const cached = baselineLlmCurveRowSchema.safeParse(JSON.parse(text));
    return cached.success ? cached.data : null;
  } catch {
    return null;
  }
}

/** The prompt, schema and cache key for one video under these settings. */
export function baselineRequest(videoId: string, settings: ExtractionSettings) {
  const systemInstruction = baselineRetentionPrompt();
  const responseSchema = geminiRetentionJsonSchema();
  const sourceUri = youtubeUrl(videoId);
  const key = extractionCacheKey({
    sourceUri,
    extractionVersion: BASELINE_PROMPT_VERSION,
    modelId: settings.model,
    promptHash: promptHash(systemInstruction, responseSchema),
    videoMode: settings.videoMode,
  });
  return { systemInstruction, responseSchema, sourceUri, key };
}

/**
 * One video's baseline curve, or the cached one. One Gemini call, retried
 * with the errors once if its answer is invalid; every raw answer is archived
 * before it is parsed (rule 6), and a valid curve is cached, so a re-run
 * costs nothing.
 */
export async function predictBaselineCurve(
  target: BaselineTarget,
  {
    settings = extractionSettings(),
    noCache = false,
    log = rootLogger,
    now = () => new Date(),
  }: {
    settings?: ExtractionSettings;
    noCache?: boolean;
    log?: Logger;
    now?: () => Date;
  } = {},
): Promise<BaselineOutcome> {
  const { channelId, videoId, durationS } = target;
  const request = baselineRequest(videoId, settings);
  const videoLog = childLogger({ video_id: videoId, stage: "baseline-llm" }, log);
  const file = rawBucket().file(cacheName(channelId, request.key));

  if (!noCache) {
    const cached = await readCached(file);
    if (cached) return { videoId, status: "cached", row: cached, errors: [] };
  }

  const contents: Content[] = [
    {
      role: "user",
      parts: [
        {
          fileData: { fileUri: request.sourceUri, mimeType: "video/*" },
          mediaProcessing:
            settings.videoMode === "agentic" ? MediaProcessing.AGENTIC : MediaProcessing.STATIC,
        },
        { text: baselineRetentionRequest(formatClock(durationS)) },
      ],
    },
  ];
  const usage = { prompt: 0, output: 0, thinking: 0, toolUse: 0 };
  let errors: string[] = [];
  for (let answer = 1; answer <= 2; answer += 1) {
    const turn: Content[] =
      answer === 1
        ? contents
        : [
            ...contents,
            {
              role: "user",
              parts: [
                { text: `Your previous answer was invalid: ${errors.join("; ")}. Answer again.` },
              ],
            },
          ];
    let text: string;
    try {
      const response = await withRetry(
        () =>
          getGenAI().models.generateContent({
            model: settings.model,
            contents: turn,
            config: {
              systemInstruction: request.systemInstruction,
              temperature: 0,
              seed: EXTRACTION_SEED,
              responseMimeType: "application/json",
              responseJsonSchema: request.responseSchema,
            },
          }),
        { operation: "vertex.generateContent(baseline-llm)", logger: videoLog },
      );
      text = response.text ?? "";
      const tokens = response.usageMetadata;
      usage.prompt += tokens?.promptTokenCount ?? 0;
      usage.output += tokens?.candidatesTokenCount ?? 0;
      usage.thinking += tokens?.thoughtsTokenCount ?? 0;
      usage.toolUse += tokens?.toolUsePromptTokenCount ?? 0;
      await archiveRaw({
        channelId,
        source: "gemini-baseline",
        key: `${videoId}-a${answer}`,
        body: { text, usageMetadata: tokens, modelVersion: response.modelVersion },
        request: { model: settings.model, videoMode: settings.videoMode, key: request.key, answer },
      });
    } catch (error) {
      return { videoId, status: "failed", row: null, errors: [errorMessage(error)] };
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      errors = ["it is not valid JSON"];
      continue;
    }
    const answerCheck = geminiRetentionSchema.safeParse(parsed);
    if (!answerCheck.success) {
      errors = answerCheck.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
      continue;
    }
    const { curve, points, repaired } = interpolateRetention(answerCheck.data.retention);
    const row = baselineLlmCurveRowSchema.parse({
      channel_id: channelId,
      video_id: videoId,
      prompt_version: BASELINE_PROMPT_VERSION,
      gemini_model: settings.model,
      video_mode: settings.videoMode,
      cache_key: request.key,
      points,
      curve,
      repaired,
      cost_usd: estimateCost(
        {
          calls: answer,
          prompt_tokens: usage.prompt,
          output_tokens: usage.output,
          thinking_tokens: usage.thinking,
          tool_use_tokens: usage.toolUse,
          latency_ms: 0,
          cost_usd: null,
        },
        settings.prices,
      ),
      created_at: now().toISOString(),
    });
    await file.save(JSON.stringify(row), { resumable: false, contentType: "application/json" });
    videoLog.info({ repaired, cost_usd: row.cost_usd }, "baseline curve predicted");
    return { videoId, status: "predicted", row, errors: [] };
  }
  return { videoId, status: "invalid", row: null, errors };
}

/** Every cached baseline curve of a channel, for rebuilding `baseline_llm_curves`. */
export async function readBaselineCurves(channelId: string): Promise<BaselineLlmCurveRow[]> {
  const bucket = rawBucket();
  const [files] = await bucket.getFiles({
    prefix: `${channelIdSchema.parse(channelId)}/baseline-llm/`,
  });
  const rows: BaselineLlmCurveRow[] = [];
  for (const { name } of files) {
    const row = await readCached(bucket.file(name));
    if (row) rows.push(row);
  }
  return rows.sort(
    (a, b) => a.video_id.localeCompare(b.video_id) || a.created_at.localeCompare(b.created_at),
  );
}
