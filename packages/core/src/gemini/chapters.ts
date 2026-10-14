import type { Logger } from "pino";
import { z } from "zod";
import { pickServerEnv } from "../env";
import { getGenAI } from "../gcp";
import { archiveRaw } from "../jobs/archive";
import { childLogger, logger as rootLogger } from "../logger";
import {
  CHAPTERS_PROMPT_VERSION,
  CHAPTER_TITLE_WORDS,
  chaptersPrompt,
  chaptersRequest,
} from "../prompts";
import { withRetry } from "../retry";
import { wordCount, type Chapter } from "../schemas";
import { errorMessage } from "./extract";
import { formatClock } from "./validate-beats";

/**
 * Chapter titles for a soundcheck (Phase 15), from Gemini's flash model at job
 * time: the beats grouped into chapters in order, each titled in at most five
 * words. An answer that breaks the rules is asked for again once, with the
 * problems; after that, or when Gemini cannot answer, there are no chapters,
 * and the soundcheck finishes without them. Raw answers are archived in the
 * uploads bucket, so they are deleted after 30 days with the upload.
 */

/** A cut needs this many beats for three chapters. */
export const MIN_CHAPTER_BEATS = 3;
/** The most chapters asked for. */
export const MAX_CHAPTERS = 8;

export interface ChapterBeat {
  startS: number;
  endS: number;
  type: string;
  summary: string;
}

const answerSchema = z.object({
  chapters: z.array(z.object({ first_beat: z.number(), title: z.string() })),
});

/** The JSON Schema Gemini answers in. */
function answerJsonSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(answerSchema) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
}

/** What is wrong with an answer, for the second ask; empty when it is fine. */
export function checkChapters(answer: unknown, beatCount: number): string[] {
  const parsed = answerSchema.safeParse(answer);
  if (!parsed.success) return ['Answer with {"chapters": [{"first_beat": 0, "title": "..."}]}.'];
  const { chapters } = parsed.data;
  const errors: string[] = [];
  if (chapters.length === 0 || chapters.length > MAX_CHAPTERS) {
    errors.push(`Give between 1 and ${MAX_CHAPTERS} chapters, not ${chapters.length}.`);
  }
  if (chapters[0] && chapters[0].first_beat !== 0) errors.push("Chapter 1 must start at beat 0.");
  chapters.forEach((chapter, i) => {
    const before = chapters[i - 1];
    if (
      !Number.isInteger(chapter.first_beat) ||
      chapter.first_beat < 0 ||
      chapter.first_beat >= beatCount
    ) {
      errors.push(`Chapter ${i + 1} starts at beat ${chapter.first_beat}, which does not exist.`);
    } else if (before && chapter.first_beat <= before.first_beat) {
      errors.push(`Chapter ${i + 1} must start after chapter ${i}.`);
    }
    const words = wordCount(chapter.title);
    if (words === 0 || words > CHAPTER_TITLE_WORDS || chapter.title.length > 60) {
      errors.push(
        `Chapter ${i + 1}'s title must be 1 to ${CHAPTER_TITLE_WORDS} words: "${chapter.title}".`,
      );
    }
  });
  return errors;
}

export async function titleChapters(
  {
    channelId,
    soundcheckId,
    beats,
    videoSummary,
  }: {
    channelId: string;
    soundcheckId: string;
    beats: readonly ChapterBeat[];
    videoSummary: string;
  },
  {
    model = pickServerEnv(["GEMINI_FLASH_MODEL"]).GEMINI_FLASH_MODEL,
    log = rootLogger,
  }: { model?: string; log?: Logger } = {},
): Promise<Chapter[] | null> {
  if (beats.length < MIN_CHAPTER_BEATS) return null;
  const chapterLog = childLogger({ step: "chapters" }, log);
  const request = {
    video_summary: videoSummary,
    beats: beats.map((beat, index) => ({
      index,
      start: formatClock(beat.startS),
      seconds: Math.round(beat.endS - beat.startS),
      type: beat.type,
      summary: beat.summary,
    })),
  };
  const contents = [{ role: "user", parts: [{ text: chaptersRequest(request) }] }];

  for (let answer = 1; answer <= 2; answer += 1) {
    let text: string;
    try {
      const response = await withRetry(
        () =>
          getGenAI().models.generateContent({
            model,
            contents,
            config: {
              systemInstruction: chaptersPrompt(),
              temperature: 0,
              responseMimeType: "application/json",
              responseJsonSchema: answerJsonSchema(),
            },
          }),
        { operation: "vertex.generateContent(chapters)", logger: chapterLog },
      );
      text = response.text ?? "";
      await archiveRaw({
        channelId,
        bucket: pickServerEnv(["GCS_UPLOADS_BUCKET"]).GCS_UPLOADS_BUCKET,
        source: "soundcheck-chapters",
        key: `${soundcheckId}-a${answer}`,
        body: { text, usageMetadata: response.usageMetadata, modelVersion: response.modelVersion },
        request: { model, promptVersion: CHAPTERS_PROMPT_VERSION, answer },
      });
    } catch (error) {
      chapterLog.warn({ err: errorMessage(error) }, "no chapters: Gemini did not answer");
      return null;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = undefined;
    }
    const errors = checkChapters(parsed, beats.length);
    if (errors.length === 0) {
      const { chapters } = answerSchema.parse(parsed);
      return chapters.map((chapter) => ({
        firstBeat: chapter.first_beat,
        title: chapter.title.trim(),
      }));
    }
    chapterLog.warn({ errors, answer }, "chapters broke the rules");
    contents.push(
      { role: "model", parts: [{ text }] },
      {
        role: "user",
        parts: [
          {
            text: `Your chapters have these problems:\n${errors.map((e) => `- ${e}`).join("\n")}\nGive all the chapters again.`,
          },
        ],
      },
    );
  }
  return null;
}
