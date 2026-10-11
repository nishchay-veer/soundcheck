import { createHash } from "node:crypto";
import { z } from "zod";
import { pickServerEnv } from "../env";
import { getGenAI, getStorage } from "../gcp";
import { archiveRaw } from "../jobs/archive";
import { childLogger, logger as rootLogger, type Logger } from "../logger";
import { NARRATION_PROMPT_VERSION, narrationPrompt, narrationRequest } from "../prompts/narration";
import { withRetry } from "../retry";
import { channelIdSchema, wordCount } from "../schemas";
import { EXTRACTION_SEED, errorMessage } from "./extract";

/**
 * Narration (Phase 11): captions for drop-offs, audience cards and the
 * channel headline, written by Gemini's flash model from facts alone.
 *
 * - Every number in a caption must appear in its facts (the digit check);
 *   so must its length fit, and it must not say "cohort" (rule 12).
 * - Captions that fail are asked for again once, with the errors; any that
 *   fail twice, or a call that fails outright, get the item's template.
 * - Every raw answer is archived (rule 6), and a finished batch is cached by
 *   a hash of its items, the model and the prompt version, so a re-run with
 *   the same facts costs nothing.
 */

export interface NarrationItem {
  id: string;
  kind: "drop" | "audience" | "headline";
  maxWords: number;
  /** Numbers and labels only: everything the caption may say. */
  facts: Record<string, unknown>;
  /** The caption when Gemini's fails; it must pass the same checks. */
  fallback: string;
}

export interface Narration {
  text: string;
  source: "gemini" | "template";
}

const answerSchema = z.object({
  items: z.array(z.object({ id: z.string(), text: z.string() })),
});

function answerJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(answerSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

const cachedSchema = z.object({
  promptVersion: z.literal(NARRATION_PROMPT_VERSION),
  model: z.string(),
  narrations: z.record(
    z.string(),
    z.object({ text: z.string(), source: z.enum(["gemini", "template"]) }),
  ),
});

const NUMBER = /\d+(?:[.,:]\d+)*/g;
const THOUSANDS = /^\d{1,3}(?:,\d{3})+$/;

/** The numbers written in a text, with thousands separators removed: "1,204" is "1204". */
export function numbersIn(text: string): string[] {
  return [...text.matchAll(NUMBER)].map(([token]) =>
    THOUSANDS.test(token) ? token.replaceAll(",", "") : token,
  );
}

/** What is wrong with a caption for an item; empty when nothing is. */
export function checkCaption(
  text: string,
  item: Pick<NarrationItem, "facts" | "maxWords">,
): string[] {
  const errors: string[] = [];
  if (!text.trim()) return ["the caption is empty"];
  const words = wordCount(text);
  if (words > item.maxWords) errors.push(`it has ${words} words, more than ${item.maxWords}`);
  const allowed = new Set(numbersIn(JSON.stringify(item.facts)));
  const invented = [...new Set(numbersIn(text).filter((number) => !allowed.has(number)))];
  if (invented.length) errors.push(`these numbers are not in the facts: ${invented.join(", ")}`);
  if (/\bcohorts?\b/i.test(text)) errors.push('it says "cohort"; use the audience labels');
  return errors;
}

/** The cache key: the prompt version, the model and every item's facts and limits. */
export function narrationKey(items: readonly NarrationItem[], model: string): string {
  const request = items.map(({ id, kind, maxWords, facts }) => ({ id, kind, maxWords, facts }));
  return createHash("sha256")
    .update(JSON.stringify({ version: NARRATION_PROMPT_VERSION, model, request }))
    .digest("hex")
    .slice(0, 32);
}

export const narrationModel = (): string =>
  pickServerEnv(["GEMINI_FLASH_MODEL"]).GEMINI_FLASH_MODEL;

const rawBucket = () => getStorage().bucket(pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET);

async function readCached(
  file: { download: () => Promise<readonly [Buffer]> },
  items: readonly NarrationItem[],
): Promise<Map<string, Narration> | null> {
  try {
    const [contents] = await file.download();
    const cached = cachedSchema.safeParse(JSON.parse(contents.toString("utf8")));
    if (!cached.success || items.some((item) => !cached.data.narrations[item.id])) return null;
    return new Map(Object.entries(cached.data.narrations));
  } catch (error) {
    if ((error as { code?: unknown }).code === 404 || error instanceof SyntaxError) return null;
    throw error;
  }
}

/**
 * Captions for a batch of items (a video's drop-offs, or the channel's cards
 * and headline), by item ID: from the cache, from Gemini, or from each item's
 * template when Gemini's caption fails the checks twice.
 */
export async function narrate(
  channelId: string,
  items: readonly NarrationItem[],
  {
    model = narrationModel(),
    noCache = false,
    log = rootLogger,
  }: { model?: string; noCache?: boolean; log?: Logger } = {},
): Promise<Map<string, Narration>> {
  if (items.length === 0) return new Map();
  if (new Set(items.map((item) => item.id)).size !== items.length) {
    throw new Error("Narration item IDs must be unique");
  }
  for (const item of items) {
    const errors = checkCaption(item.fallback, item);
    if (errors.length) throw new Error(`The template for ${item.id} fails: ${errors.join("; ")}`);
  }
  const key = narrationKey(items, model);
  const narrationLog = childLogger({ channel_id: channelId, stage: "narrate" }, log);
  const file = rawBucket().file(`${channelIdSchema.parse(channelId)}/narration/${key}.json`);
  if (!noCache) {
    const cached = await readCached(file, items);
    if (cached) return cached;
  }

  const narrations = new Map<string, Narration>();
  let pending = [...items];
  let feedback: string[] = [];
  const usage = { calls: 0, input: 0, output: 0 };

  for (let answer = 1; answer <= 2 && pending.length > 0; answer += 1) {
    const request = pending.map(({ id, kind, maxWords, facts }) => ({ id, kind, maxWords, facts }));
    const text = [
      narrationRequest(request),
      ...(feedback.length
        ? [`Your earlier captions for these items broke the rules:\n${feedback.join("\n")}`]
        : []),
    ].join("\n\n");
    let reply: string;
    try {
      const response = await withRetry(
        () =>
          getGenAI().models.generateContent({
            model,
            contents: [{ role: "user", parts: [{ text }] }],
            config: {
              systemInstruction: narrationPrompt(),
              temperature: 0,
              seed: EXTRACTION_SEED,
              responseMimeType: "application/json",
              responseJsonSchema: answerJsonSchema(),
            },
          }),
        { operation: "vertex.generateContent(narrate)", logger: narrationLog },
      );
      reply = response.text ?? "";
      usage.calls += 1;
      usage.input += response.usageMetadata?.promptTokenCount ?? 0;
      usage.output += response.usageMetadata?.candidatesTokenCount ?? 0;
      await archiveRaw({
        channelId,
        source: "gemini-narration",
        key: `${key}-a${answer}`,
        body: {
          text: reply,
          usageMetadata: response.usageMetadata,
          modelVersion: response.modelVersion,
        },
        request: { model, promptVersion: NARRATION_PROMPT_VERSION, items: request.length, answer },
      });
    } catch (error) {
      // No answer at all: templates for this run, and nothing cached.
      narrationLog.warn({ err: errorMessage(error) }, "narration failed; using templates");
      return new Map(items.map((item) => [item.id, narrations.get(item.id) ?? template(item)]));
    }

    let captions = new Map<string, string>();
    try {
      const parsed = answerSchema.safeParse(JSON.parse(reply));
      if (parsed.success) captions = new Map(parsed.data.items.map((item) => [item.id, item.text]));
    } catch {
      // Not JSON: every pending item is asked for again.
    }
    feedback = [];
    const failed: NarrationItem[] = [];
    for (const item of pending) {
      const caption = captions.get(item.id);
      const errors = caption === undefined ? ["no caption was given"] : checkCaption(caption, item);
      if (caption !== undefined && errors.length === 0) {
        narrations.set(item.id, { text: caption.trim(), source: "gemini" });
      } else {
        failed.push(item);
        feedback.push(`- ${item.id}: ${errors.join("; ")}`);
      }
    }
    pending = failed;
  }

  for (const item of pending) narrations.set(item.id, template(item));
  const templated = items.filter((item) => narrations.get(item.id)?.source === "template");
  narrationLog.info(
    {
      items: items.length,
      templated: templated.map((item) => item.id),
      calls: usage.calls,
      input_count: usage.input,
      output_count: usage.output,
    },
    "narrated",
  );
  await file.save(
    JSON.stringify({
      promptVersion: NARRATION_PROMPT_VERSION,
      model,
      narrations: Object.fromEntries(items.map((item) => [item.id, narrations.get(item.id)])),
    }),
    { resumable: false, contentType: "application/json" },
  );
  return narrations;
}

const template = (item: NarrationItem): Narration => ({ text: item.fallback, source: "template" });
