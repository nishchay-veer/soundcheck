/**
 * Phase 05 probe: checks how Gemini on Vertex AI reads a YouTube video before
 * beat extraction is built. For one video of a connected channel it tries the
 * YouTube URL as `fileData` in static and agentic processing, default and low
 * media resolution, start and end offsets, and structured JSON output, and
 * prints for each: success or the API's error, latency, tokens by modality
 * (video, audio, text, thinking, tool use) and, for structured answers, how
 * much of the video the returned segments cover. The video ID is masked.
 *
 * `--only` takes one or more label prefixes, comma-separated.
 *
 *   pnpm --filter @soundcheck/scripts probe-gemini-video --channel <CHANNEL_ID> [--video <VIDEO_ID>] [--model <MODEL_ID>] [--only <label prefixes>]
 */
import { parseArgs } from "node:util";
import {
  GoogleGenAI,
  MediaProcessing,
  MediaResolution,
  PartMediaResolutionLevel,
  type GenerateContentConfig,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { pickServerEnv, withRetry } from "@soundcheck/core";
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

const { values } = parseArgs({
  options: {
    channel: { type: "string" },
    video: { type: "string" },
    model: { type: "string" },
    only: { type: "string" },
  },
});
const channelId = values.channel ?? "";
if (!channelIdSchema.safeParse(channelId).success) {
  process.stderr.write(
    "Usage: probe-gemini-video --channel <CHANNEL_ID> [--video <VIDEO_ID>] [--model <MODEL_ID>] [--only <label prefix>]\n",
  );
  process.exit(2);
}

const env = pickServerEnv(["GCP_PROJECT_ID", "GEMINI_LOCATION", "GEMINI_MODEL"]);
const model = values.model ?? env.GEMINI_MODEL;
const ai = new GoogleGenAI({
  vertexai: true,
  project: env.GCP_PROJECT_ID,
  location: env.GEMINI_LOCATION,
});

// The video: the one given, or the channel's longest upload.
const channel = await loadChannel(channelId);
const auth = await credentialsForChannel(channelId);
const ids = parseUploadsPage(
  await fetchUploadsPage(auth, uploadsPageRequest(channel.uploadsPlaylistId)),
).videoIds;
const videos = parseVideos(await fetchVideos(auth, videosRequest(ids.slice(0, 50))));
const video =
  videos.find((v) => v.id === values.video) ??
  [...videos].sort((a, b) => b.durationS - a.durationS)[0];
if (!video) {
  process.stderr.write("The channel has no uploads to probe.\n");
  process.exit(1);
}
const { id: videoId, durationS, privacyStatus } = video;
const mask = (text: string) => text.replaceAll(videoId, "VIDEO");
const print = (line = "") => process.stdout.write(`${mask(line)}\n`);

const url = `https://www.youtube.com/watch?v=${videoId}`;
const SEGMENT_PROMPT =
  "Split this whole video into contiguous segments, each with one purpose (hook, intro, " +
  "explanation, demonstration, outro and so on). Cover the video from 0 seconds to its end " +
  "with no gaps or overlaps. Timestamps are seconds from the start.";
const CLOCK_PROMPT = SEGMENT_PROMPT.replace(
  "Timestamps are seconds from the start.",
  'Timestamps are "M:SS" from the start, for example "4:13".',
);
const SECONDS_PROMPT = SEGMENT_PROMPT.replace(
  "Timestamps are seconds from the start.",
  "Timestamps are a number of seconds from the start: 4 minutes 13 seconds is 253, never 413.",
);
const clock = {
  type: "string",
  pattern: "^[0-9]+:[0-5][0-9]$",
  description: 'Time from the start as "M:SS"',
};
const seconds = {
  type: "number",
  description: "Seconds from the start of the video, e.g. 253 for 4:13",
};
const segmentSchema = (time: object) => ({
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: { start: time, end: time, label: { type: "string" } },
        required: ["start", "end", "label"],
      },
    },
  },
  required: ["segments"],
});
const SEGMENT_SCHEMA = {
  type: "object",
  properties: {
    segments: {
      type: "array",
      items: {
        type: "object",
        properties: {
          start_s: { type: "number" },
          end_s: { type: "number" },
          label: { type: "string" },
        },
        required: ["start_s", "end_s", "label"],
      },
    },
  },
  required: ["segments"],
};

interface Probe {
  label: string;
  part: Part;
  config?: GenerateContentConfig;
  prompt?: string;
  structured?: boolean;
}

const youtube = (extra: Partial<Part> = {}): Part => ({
  fileData: { fileUri: url, mimeType: "video/*" },
  ...extra,
});
const structured: GenerateContentConfig = {
  temperature: 0,
  seed: 20261004,
  responseMimeType: "application/json",
  responseJsonSchema: SEGMENT_SCHEMA,
};

const probes: Probe[] = [
  {
    label: "static: YouTube URL, default resolution",
    part: youtube({ mediaProcessing: MediaProcessing.STATIC }),
  },
  {
    label: "agentic: YouTube URL, default resolution",
    part: youtube({ mediaProcessing: MediaProcessing.AGENTIC }),
  },
  { label: "default processing (unspecified)", part: youtube() },
  {
    label: "static: low media resolution",
    part: youtube({ mediaProcessing: MediaProcessing.STATIC }),
    config: { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW },
  },
  {
    label: "agentic: low media resolution",
    part: youtube({ mediaProcessing: MediaProcessing.AGENTIC }),
    config: { mediaResolution: MediaResolution.MEDIA_RESOLUTION_LOW },
  },
  {
    label: "static: 60 s to 120 s only (videoMetadata offsets)",
    part: youtube({
      mediaProcessing: MediaProcessing.STATIC,
      videoMetadata: { startOffset: "60s", endOffset: "120s" },
    }),
  },
  {
    label: "structured: static, responseJsonSchema",
    part: youtube({ mediaProcessing: MediaProcessing.STATIC }),
    config: structured,
    prompt: SEGMENT_PROMPT,
    structured: true,
  },
  {
    label: "structured: agentic, responseJsonSchema",
    part: youtube({ mediaProcessing: MediaProcessing.AGENTIC }),
    config: structured,
    prompt: SEGMENT_PROMPT,
    structured: true,
  },
  {
    label: "structured: agentic, responseJsonSchema, run again (same seed)",
    part: youtube({ mediaProcessing: MediaProcessing.AGENTIC }),
    config: structured,
    prompt: SEGMENT_PROMPT,
    structured: true,
  },
  {
    label: "static: low resolution on the video part",
    part: youtube({
      mediaProcessing: MediaProcessing.STATIC,
      mediaResolution: { level: PartMediaResolutionLevel.MEDIA_RESOLUTION_LOW },
    }),
  },
  {
    label: "structured timestamps: static, M:SS strings",
    part: youtube({ mediaProcessing: MediaProcessing.STATIC }),
    config: { ...structured, responseJsonSchema: segmentSchema(clock) },
    prompt: CLOCK_PROMPT,
    structured: true,
  },
  {
    label: "structured timestamps: static, seconds with descriptions",
    part: youtube({ mediaProcessing: MediaProcessing.STATIC }),
    config: { ...structured, responseJsonSchema: segmentSchema(seconds) },
    prompt: SECONDS_PROMPT,
    structured: true,
  },
  {
    label: "structured timestamps: agentic, M:SS strings",
    part: youtube({ mediaProcessing: MediaProcessing.AGENTIC }),
    config: { ...structured, responseJsonSchema: segmentSchema(clock) },
    prompt: CLOCK_PROMPT,
    structured: true,
  },
].filter(
  ({ label }) =>
    !values.only || values.only.split(",").some((prefix) => label.startsWith(prefix.trim())),
);

/** The API's own message for a failed call. */
function describeError(error: unknown): string {
  const { status, message } = error as { status?: number; message?: string };
  return `${status ? `HTTP ${status}: ` : ""}${message ?? String(error)}`.slice(0, 400);
}

function usage(response: GenerateContentResponse): string {
  const u = response.usageMetadata;
  const byModality = (details?: Array<{ modality?: string; tokenCount?: number }>) =>
    (details ?? []).map((d) => `${d.modality}=${d.tokenCount}`).join(" ") || "-";
  return [
    `prompt ${u?.promptTokenCount ?? "?"} (${byModality(u?.promptTokensDetails)})`,
    `output ${u?.candidatesTokenCount ?? "?"}`,
    `thinking ${u?.thoughtsTokenCount ?? 0}`,
    `tool use ${u?.toolUsePromptTokenCount ?? 0}`,
    `total ${u?.totalTokenCount ?? "?"}`,
  ].join(", ");
}

/** Seconds from a number or an "M:SS" / "H:MM:SS" string. */
function toSeconds(value: unknown): number {
  if (typeof value === "number") return value;
  return String(value)
    .split(":")
    .reduce((total, part) => total * 60 + Number(part), 0);
}

/** How much of the video a structured answer's segments cover, and where the gaps are. */
function coverage(text: string): string {
  const raw = (JSON.parse(text) as { segments: Array<Record<string, unknown>> }).segments;
  const segments = raw.map((segment) => ({
    start_s: toSeconds(segment.start_s ?? segment.start),
    end_s: toSeconds(segment.end_s ?? segment.end),
    label: String(segment.label),
  }));
  const pastEnd = segments.filter((s) => s.start_s > durationS + 2 || s.end_s > durationS + 2);
  const sorted = [...segments].sort((a, b) => a.start_s - b.start_s);
  let covered = 0;
  let cursor = 0;
  const gaps: string[] = [];
  for (const segment of sorted) {
    if (segment.start_s > cursor + 2) gaps.push(`${cursor}-${segment.start_s}`);
    covered += Math.max(0, Math.min(segment.end_s, durationS) - Math.max(segment.start_s, cursor));
    cursor = Math.max(cursor, segment.end_s);
  }
  if (durationS > cursor + 2) gaps.push(`${cursor}-${durationS}`);
  const labels = sorted.map((s) => `${s.start_s}-${s.end_s} ${s.label}`).join(" | ");
  return [
    `${segments.length} segments, ${((100 * covered) / durationS).toFixed(1)}% of ${durationS} s covered, gaps over 2 s: ${gaps.join(", ") || "none"}, times past the end: ${pastEnd.length}`,
    `    ${labels.slice(0, 600)}`,
  ].join("\n");
}

print(`# Gemini video probe, ${new Date().toISOString().slice(0, 10)}`);
print(
  `Model ${model} on Vertex AI (${env.GEMINI_LOCATION}); video VIDEO, ${durationS} s, ${privacyStatus}.`,
);

let calls = 0;
let tokens = 0;
for (const probe of probes) {
  print();
  print(`## ${probe.label}`);
  const started = Date.now();
  try {
    calls += 1;
    const response = await withRetry(
      () =>
        ai.models.generateContent({
          model,
          contents: [
            {
              role: "user",
              parts: [
                probe.part,
                { text: probe.prompt ?? "Describe what happens in this video in two sentences." },
              ],
            },
          ],
          config: probe.config,
        }),
      { operation: "vertex.generateContent(probe)", maxAttempts: 2 },
    );
    tokens += response.usageMetadata?.totalTokenCount ?? 0;
    print(`  OK in ${((Date.now() - started) / 1000).toFixed(1)} s. tokens: ${usage(response)}`);
    const text = response.text ?? "";
    print(
      probe.structured
        ? `  ${coverage(text)}`
        : `  answer: ${text.replaceAll("\n", " ").slice(0, 240)}`,
    );
  } catch (error) {
    print(`  ERROR after ${((Date.now() - started) / 1000).toFixed(1)} s. ${describeError(error)}`);
  }
}

print();
print(`${calls} Gemini calls, ${tokens} tokens in total.`);
