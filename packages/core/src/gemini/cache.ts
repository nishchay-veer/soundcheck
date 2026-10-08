import { createHash } from "node:crypto";
import { z } from "zod";
import { pickServerEnv } from "../env";
import { getStorage } from "../gcp";
import { channelIdSchema, videoBeatsSchema } from "../schemas";

/**
 * Extraction cache. A validated extraction is stored in the raw bucket under
 * the channel, keyed by everything that changes the answer; a cache hit skips
 * the Gemini call, so a re-run costs no tokens.
 */

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** Hash of the system instruction and the response schema: any prompt change misses the cache. */
export function promptHash(systemInstruction: string, responseSchema: unknown): string {
  return sha256(JSON.stringify([systemInstruction, responseSchema]));
}

export interface CacheKeyInput {
  /** The YouTube URL or `gs://` URI Gemini reads. */
  sourceUri: string;
  extractionVersion: string;
  modelId: string;
  promptHash: string;
  /** `static` or `agentic`: it changes what the model sees. */
  videoMode: string;
}

/** `sha256(source, EXTRACTION_VERSION, model, prompt hash, video mode)`, hex. */
export function extractionCacheKey(input: CacheKeyInput): string {
  return sha256(
    JSON.stringify([
      input.sourceUri,
      input.extractionVersion,
      input.modelId,
      input.promptHash,
      input.videoMode,
    ]),
  );
}

/** What one extraction cost and how it went, kept with the cached result. */
export const extractionUsageSchema = z.object({
  /** Gemini calls made, including the validation retry and every window. */
  calls: z.number().int().nonnegative(),
  prompt_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  thinking_tokens: z.number().int().nonnegative(),
  tool_use_tokens: z.number().int().nonnegative(),
  latency_ms: z.number().nonnegative(),
  /** US dollars at the configured prices; null when prices are not set. */
  cost_usd: z.number().nonnegative().nullable(),
});
export type ExtractionUsage = z.infer<typeof extractionUsageSchema>;

/** A cached, validated extraction. */
export const cachedExtractionSchema = z.object({
  key: z.string().regex(/^[0-9a-f]{64}$/),
  channel_id: channelIdSchema,
  video_id: z.string().min(1),
  source_uri: z.string().min(1),
  extraction_version: z.string().min(1),
  gemini_model: z.string().min(1),
  video_mode: z.string().min(1),
  prompt_hash: z.string().regex(/^[0-9a-f]{64}$/),
  duration_s: z.number().positive(),
  coverage: z.number().min(0).max(1),
  extracted_at: z.iso.datetime({ offset: true }),
  usage: extractionUsageSchema,
  beats: videoBeatsSchema,
});
export type CachedExtraction = z.infer<typeof cachedExtractionSchema>;

/** `{channel}/beats/{video}/{key}.json` in the raw bucket, under the channel so deletion covers it. */
export function cacheObjectName(channelId: string, videoId: string, key: string): string {
  channelIdSchema.parse(channelId);
  if (!/^[\w-]+$/.test(videoId)) throw new RangeError(`Invalid video ID: ${videoId}`);
  if (!/^[0-9a-f]{64}$/.test(key)) throw new RangeError(`Invalid cache key: ${key}`);
  return `${channelId}/beats/${videoId}/${key}.json`;
}

const rawBucket = () => getStorage().bucket(pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET);

/** The cached extraction for this key, or null on a miss or an unreadable entry. */
export async function readCachedExtraction(
  channelId: string,
  videoId: string,
  key: string,
): Promise<CachedExtraction | null> {
  const file = rawBucket().file(cacheObjectName(channelId, videoId, key));
  let text: string;
  try {
    const [contents] = await file.download();
    text = contents.toString("utf8");
  } catch (error) {
    if ((error as { code?: unknown }).code === 404) return null;
    throw error;
  }
  try {
    const cached = cachedExtractionSchema.safeParse(JSON.parse(text));
    return cached.success ? cached.data : null;
  } catch {
    return null; // corrupt: extract again and overwrite it
  }
}

/** Stores a validated extraction under its key. */
export async function writeCachedExtraction(extraction: CachedExtraction): Promise<string> {
  const entry = cachedExtractionSchema.parse(extraction);
  const name = cacheObjectName(entry.channel_id, entry.video_id, entry.key);
  await rawBucket()
    .file(name)
    .save(JSON.stringify(entry), { resumable: false, contentType: "application/json" });
  return name;
}
