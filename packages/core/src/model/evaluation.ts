import { EVALUATION_SPLIT } from "./config";

/**
 * Which of a channel's videos Phase 09 holds out, so the generic-LLM baseline
 * (TypeScript) is asked about the same videos the evaluation (Python) scores.
 * Python applies the same rule with the same numbers (`evaluate.choose_split`).
 */

export interface SplitVideo {
  videoId: string;
  /** Publish date, `YYYY-MM-DD`. */
  published: string;
}

const DAY_MS = 86_400_000;
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / DAY_MS);

export function evaluationTestVideos(
  videos: readonly SplitVideo[],
  asOf: string,
  minTrainVideos: number,
): { mode: "holdout" | "check"; test: string[] } {
  const settled = videos
    .filter((video) => days(video.published, asOf) >= EVALUATION_SPLIT.minAgeDays)
    .sort((a, b) => a.published.localeCompare(b.published) || a.videoId.localeCompare(b.videoId))
    .map((video) => video.videoId);
  const tested = Math.max(
    EVALUATION_SPLIT.minTestVideos,
    Math.ceil(EVALUATION_SPLIT.testShare * settled.length),
  );
  if (settled.length - tested >= minTrainVideos) {
    return { mode: "holdout", test: settled.slice(-tested) };
  }
  if (settled.length < 2) {
    throw new RangeError(`Evaluation needs at least 2 settled videos; there are ${settled.length}`);
  }
  return { mode: "check", test: settled };
}
