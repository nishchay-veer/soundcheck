/**
 * Phase 14 probe: checks which new cuts Gemini on Vertex AI can watch before
 * soundchecks are built on them.
 *
 * - **YouTube links:** for one public, one unlisted and one private video of
 *   a connected channel (the shortest of each, found through the channel's
 *   own credentials), a one-sentence description through the YouTube URL.
 * - **Cloud Storage files:** Google's public sample video, copied into the
 *   uploads bucket under `{channel}/probe/`, read through its `gs://` URI with
 *   the MIME type `video/*` and `video/mp4`. `--gcs` probes another object.
 *
 * Each call prints success or the API's error, latency and tokens. Video IDs
 * are masked. Runs as whoever runs it (locally, your ADC); the job runs as
 * sa-pipeline.
 *
 *   pnpm --filter @soundcheck/scripts probe-soundcheck-inputs --channel <CHANNEL_ID> [--gcs <gs://bucket/object>] [--model <MODEL_ID>]
 */
import { parseArgs } from "node:util";
import type { GenerateContentResponse, Part } from "@google/genai";
import { GoogleGenAI, MediaProcessing } from "@google/genai";
import { getStorage, pickServerEnv, withRetry } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import { channelIdSchema } from "@soundcheck/core/schemas";
import {
  credentialsForChannel,
  fetchUploadsPage,
  fetchVideos,
  parseUploadsPage,
  parseVideos,
  uploadsPageRequest,
  videosRequest,
} from "@soundcheck/core/youtube";

/** Google's public sample video (about a minute), from the Vertex AI docs. */
const SAMPLE = { bucket: "cloud-samples-data", object: "generative-ai/video/pixel8.mp4" };
const PROMPT = "Describe this video in one sentence.";

const { values } = parseArgs({
  options: {
    channel: { type: "string" },
    gcs: { type: "string" },
    model: { type: "string" },
  },
});
const channelId = values.channel ?? "";
if (!channelIdSchema.safeParse(channelId).success) {
  process.stderr.write(
    "Usage: probe-soundcheck-inputs --channel <CHANNEL_ID> [--gcs <gs://bucket/object>] [--model <MODEL_ID>]\n",
  );
  process.exit(2);
}

const env = pickServerEnv([
  "GCP_PROJECT_ID",
  "GEMINI_LOCATION",
  "GEMINI_MODEL",
  "GCS_UPLOADS_BUCKET",
]);
const model = values.model ?? env.GEMINI_MODEL;
const ai = new GoogleGenAI({
  vertexai: true,
  project: env.GCP_PROJECT_ID,
  location: env.GEMINI_LOCATION,
});

// Every upload of the channel, through its own credentials, so unlisted and
// private videos are listed too.
const channel = await loadChannel(channelId);
const auth = await credentialsForChannel(channelId);
const ids: string[] = [];
let pageToken: string | undefined;
do {
  const page = parseUploadsPage(
    await fetchUploadsPage(auth, uploadsPageRequest(channel.uploadsPlaylistId, pageToken)),
  );
  ids.push(...page.videoIds);
  pageToken = page.nextPageToken ?? undefined;
} while (pageToken && ids.length < 500);
const videos: ReturnType<typeof parseVideos> = [];
for (let i = 0; i < ids.length; i += 50) {
  videos.push(...parseVideos(await fetchVideos(auth, videosRequest(ids.slice(i, i + 50)))));
}
const masks = new Map(videos.map((video, i) => [video.id, `VIDEO_${i + 1}`]));
const mask = (text: string) =>
  [...masks].reduce((masked, [id, name]) => masked.replaceAll(id, name), text);
const print = (line = "") => process.stdout.write(`${mask(line)}\n`);

/** The API's own message for a failed call. */
function describeError(error: unknown): string {
  const { status, message } = error as { status?: number; message?: string };
  return `${status ? `HTTP ${status}: ` : ""}${message ?? String(error)}`.slice(0, 500);
}

function usage(response: GenerateContentResponse): string {
  const u = response.usageMetadata;
  const byModality = (details?: Array<{ modality?: string; tokenCount?: number }>) =>
    (details ?? []).map((d) => `${d.modality}=${d.tokenCount}`).join(" ") || "-";
  return `prompt ${u?.promptTokenCount ?? "?"} (${byModality(u?.promptTokensDetails)}), total ${u?.totalTokenCount ?? "?"}`;
}

/** One description call; prints the outcome. */
async function probe(label: string, part: Part): Promise<void> {
  print();
  print(`## ${label}`);
  const started = Date.now();
  try {
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model,
          contents: [{ role: "user", parts: [part, { text: PROMPT }] }],
          config: { temperature: 0 },
        }),
      { operation: "vertex.generateContent(probe)", maxAttempts: 2 },
    );
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    print(`  OK in ${seconds} s. tokens: ${usage(response)}`);
    print(`  answer: ${(response.text ?? "").trim().slice(0, 240)}`);
  } catch (error) {
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    print(`  FAILED after ${seconds} s: ${describeError(error)}`);
  }
}

print(`# Soundcheck inputs probe, ${new Date().toISOString().slice(0, 10)}`);
print(`Model ${model} on Vertex AI (${env.GEMINI_LOCATION}); channel uploads: ${videos.length}.`);

// YouTube links, by privacy.
for (const privacy of ["public", "unlisted", "private"] as const) {
  const shortest = videos
    .filter((video) => video.privacyStatus === privacy)
    .sort((a, b) => a.durationS - b.durationS)[0];
  if (!shortest) {
    print();
    print(`## YouTube link, ${privacy}`);
    print(`  SKIPPED: the channel has no ${privacy} video.`);
    continue;
  }
  await probe(`YouTube link, ${privacy} (${shortest.id}, ${shortest.durationS} s)`, {
    fileData: { fileUri: `https://www.youtube.com/watch?v=${shortest.id}`, mimeType: "video/*" },
    mediaProcessing: MediaProcessing.STATIC,
  });
}

// A file in Cloud Storage: the one given, or the sample copied into uploads.
let uri = values.gcs;
if (!uri) {
  const target = getStorage().bucket(env.GCS_UPLOADS_BUCKET).file(`${channelId}/probe/sample.mp4`);
  const [exists] = await target.exists();
  if (!exists) {
    await getStorage().bucket(SAMPLE.bucket).file(SAMPLE.object).copy(target);
  }
  uri = `gs://${env.GCS_UPLOADS_BUCKET}/${target.name}`;
}
for (const mimeType of ["video/*", "video/mp4"]) {
  await probe(`Cloud Storage file, ${mimeType}: ${uri}`, {
    fileData: { fileUri: uri, mimeType },
    mediaProcessing: MediaProcessing.STATIC,
  });
}
