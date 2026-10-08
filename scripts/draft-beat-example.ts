/**
 * Drafts a few-shot beat example: Gemini annotates one of a connected
 * channel's videos with the zero-shot extraction prompt (no examples), and the
 * answer is written to packages/core/src/prompts/examples/<name>.json with
 * `reviewed: false`. A person then watches the video, corrects the annotation
 * and sets `reviewed: true`; only then is it a hand-checked example.
 *
 *   pnpm --filter @soundcheck/scripts draft-beat-example --channel <CHANNEL_ID> --video <VIDEO_ID> --name <file name> --description "<what the video is>"
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { GoogleGenAI, MediaProcessing } from "@google/genai";
import { pickServerEnv, withRetry } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import { EXTRACT_BEATS_INSTRUCTIONS } from "@soundcheck/core/prompts";
import {
  channelIdSchema,
  geminiResponseJsonSchema,
  geminiVideoBeatsSchema,
} from "@soundcheck/core/schemas";
import {
  credentialsForChannel,
  fetchVideos,
  parseVideos,
  videosRequest,
} from "@soundcheck/core/youtube";

const { values } = parseArgs({
  options: {
    channel: { type: "string" },
    video: { type: "string" },
    name: { type: "string" },
    description: { type: "string" },
  },
});
const { channel: channelId = "", video: videoId, name, description } = values;
if (
  !channelIdSchema.safeParse(channelId).success ||
  !videoId ||
  !name ||
  !/^[a-z0-9-]+$/.test(name) ||
  !description
) {
  process.stderr.write(
    'Usage: draft-beat-example --channel <CHANNEL_ID> --video <VIDEO_ID> --name <kebab-case> --description "<what the video is>"\n',
  );
  process.exit(2);
}

const env = pickServerEnv(["GCP_PROJECT_ID", "GEMINI_LOCATION", "GEMINI_MODEL"]);
await loadChannel(channelId);
const [video] = parseVideos(
  await fetchVideos(await credentialsForChannel(channelId), videosRequest([videoId])),
);
if (!video) {
  process.stderr.write(`Video ${videoId} was not found.\n`);
  process.exit(1);
}
const duration = `${Math.floor(video.durationS / 60)}:${String(video.durationS % 60).padStart(2, "0")}`;

const ai = new GoogleGenAI({
  vertexai: true,
  project: env.GCP_PROJECT_ID,
  location: env.GEMINI_LOCATION,
});
const response = await withRetry(
  () =>
    ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents: [
        {
          role: "user",
          parts: [
            {
              fileData: {
                fileUri: `https://www.youtube.com/watch?v=${videoId}`,
                mimeType: "video/*",
              },
              mediaProcessing: MediaProcessing.STATIC,
            },
            { text: `Annotate this video. It lasts ${duration}.` },
          ],
        },
      ],
      config: {
        systemInstruction: EXTRACT_BEATS_INSTRUCTIONS,
        temperature: 0,
        seed: 20261004,
        responseMimeType: "application/json",
        responseJsonSchema: geminiResponseJsonSchema(),
      },
    }),
  { operation: "vertex.generateContent(draft-beat-example)" },
);

const answer = geminiVideoBeatsSchema.safeParse(JSON.parse(response.text ?? "null"));
const file = new URL(`../packages/core/src/prompts/examples/${name}.json`, import.meta.url);
writeFileSync(
  file,
  `${JSON.stringify(
    {
      description,
      duration,
      reviewed: false,
      annotation: answer.success ? answer.data : JSON.parse(response.text ?? "null"),
    },
    null,
    2,
  )}\n`,
);
const usage = response.usageMetadata;
process.stdout.write(
  `wrote ${file.pathname.split("/soundcheck/")[1]}: ${answer.success ? `${answer.data.beats.length} beats` : `INVALID: ${answer.error.message}`}; ` +
    `tokens ${usage?.promptTokenCount} in, ${usage?.candidatesTokenCount} out, ${usage?.thoughtsTokenCount ?? 0} thinking\n`,
);
