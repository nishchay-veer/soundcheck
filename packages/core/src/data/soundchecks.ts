import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import { pickServerEnv } from "../env";
import {
  NotBuiltError,
  NotFoundError,
  SoundcheckNotConfiguredError,
  SoundcheckRejectedError,
} from "../errors";
import { getFirestore, getStorage, getWorkflowExecutions } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { withRetry } from "../retry";
import {
  SOUNDCHECK_LIMITS,
  UPLOAD_CHUNK_BYTES,
  channelIdSchema,
  parseYouTubeLink,
  servingPaths,
  soundcheckDocSchema,
  soundcheckIdSchema,
  soundcheckPaths,
  uploadObjectName,
  uploadTypeSchema,
  type SoundcheckCreate,
  type SoundcheckCreated,
  type SoundcheckDoc,
} from "../schemas";
import { EXTRACTION_VERSION, FEATURE_VERSION } from "../versions";
import { requireChannel } from "./authz";
import { readCollection, readDocument, refuseInFixturesMode } from "./store";

/**
 * Soundchecks on the request path (Phase 14). Creating one writes its
 * document and either opens an upload session (a file) or starts the
 * `soundcheck` workflow (a link); the job does the rest. Nothing here waits
 * on Gemini or reads BigQuery.
 */

/** The workflow's resource name, from WORKFLOW_SOUNDCHECK (a name or a full path). */
export function soundcheckWorkflow(): string | null {
  const env = pickServerEnv(["GCP_PROJECT_ID", "GCP_REGION", "WORKFLOW_SOUNDCHECK"]);
  const name = env.WORKFLOW_SOUNDCHECK;
  if (!name) return null;
  return name.startsWith("projects/")
    ? name
    : `projects/${env.GCP_PROJECT_ID}/locations/${env.GCP_REGION}/workflows/${name}`;
}

export interface UploadSessionRequest {
  bucket: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  /** The page's origin, so Cloud Storage lets the browser send the chunks (CORS). */
  origin: string;
}

/**
 * Opens a resumable upload to Cloud Storage and returns its session URL. The
 * server fixes the object, its type and its exact size, and the object must
 * not exist yet, so the session can upload that one file and nothing else.
 * No signing permission is needed: the session URL is the credential.
 */
export async function openUploadSession(request: UploadSessionRequest): Promise<string> {
  const url =
    `https://storage.googleapis.com/upload/storage/v1/b/${encodeURIComponent(request.bucket)}/o` +
    `?uploadType=resumable&ifGenerationMatch=0&name=${encodeURIComponent(request.name)}`;
  const response = await withRetry(
    () =>
      getStorage().authClient.request({
        url,
        method: "POST",
        headers: {
          "Content-Type": "application/json; charset=UTF-8",
          "X-Upload-Content-Type": request.contentType,
          "X-Upload-Content-Length": String(request.sizeBytes),
          Origin: request.origin,
        },
        data: { name: request.name, contentType: request.contentType },
      }),
    { operation: "storage.createResumableUpload" },
  );
  const headers = response.headers as unknown as
    { get?: (name: string) => string | null; location?: string } | undefined;
  const location = typeof headers?.get === "function" ? headers.get("location") : headers?.location;
  if (!location) throw new Error("Cloud Storage opened no upload session");
  return location;
}

/** A new soundcheck's ID: 32 hex characters, like a run ID. */
const newSoundcheckId = () => randomUUID().replaceAll("-", "");

/**
 * Creates a soundcheck of one of the user's channels. Refused (in this order)
 * in fixtures mode, without the workflow configured, for someone else's
 * channel (404), before the channel's first build has published (409), and for
 * a file of another type or over 2 GB, or a link that is not a YouTube video.
 */
export async function createSoundcheck(
  userId: string,
  channelId: string,
  request: SoundcheckCreate,
  {
    origin,
    now = new Date(),
    log = rootLogger,
    openUpload = openUploadSession,
  }: {
    origin: string;
    now?: Date;
    log?: Logger;
    openUpload?: (request: UploadSessionRequest) => Promise<string>;
  },
): Promise<SoundcheckCreated> {
  refuseInFixturesMode("starting a soundcheck");
  const workflow = soundcheckWorkflow();
  if (!workflow) throw new SoundcheckNotConfiguredError();
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  const [, summary] = await Promise.all([
    requireChannel(userId, channelId),
    readDocument(servingPaths(channelId).summary),
  ]);
  if (summary === undefined) throw new NotBuiltError(channelId);

  const soundcheckId = newSoundcheckId();
  const at = now.toISOString();
  const base = {
    soundcheckId,
    channelId,
    title: request.title,
    scenario: request.scenario,
    progress: null,
    error: null,
    durationS: null,
    beats: null,
    prediction: null,
    edits: [],
    narrative: null,
    extractionVersion: EXTRACTION_VERSION,
    featureVersion: FEATURE_VERSION,
    createdAt: at,
    updatedAt: at,
  };
  const ref = getFirestore().doc(soundcheckPaths(channelId).soundcheck(soundcheckId));
  const soundcheckLog = childLogger(
    { channel_id: channelId, soundcheck_id: soundcheckId, stage: "soundcheck" },
    log,
  );

  if (request.kind === "file") {
    const type = uploadTypeSchema.safeParse(request.contentType);
    if (!type.success) {
      throw new SoundcheckRejectedError(
        "unsupported_type",
        "Soundcheck takes MP4, MOV or WebM videos.",
      );
    }
    if (request.sizeBytes > SOUNDCHECK_LIMITS.maxUploadBytes) {
      throw new SoundcheckRejectedError(
        "too_large",
        "This file is over 2 GB. Export a smaller file and try again.",
      );
    }
    const bucket = pickServerEnv(["GCS_UPLOADS_BUCKET"]).GCS_UPLOADS_BUCKET;
    const name = uploadObjectName(channelId, soundcheckId, type.data);
    const sessionUrl = await openUpload({
      bucket,
      name,
      contentType: type.data,
      sizeBytes: request.sizeBytes,
      origin,
    });
    const doc: SoundcheckDoc = soundcheckDocSchema.parse({
      ...base,
      status: "awaiting_upload",
      input: {
        kind: "file",
        fileName: request.fileName,
        contentType: type.data,
        sizeBytes: request.sizeBytes,
        uri: `gs://${bucket}/${name}`,
      },
    });
    await ref.set(doc);
    soundcheckLog.info(
      { kind: "file", size_bytes: request.sizeBytes },
      "soundcheck awaiting upload",
    );
    return {
      soundcheckId,
      status: doc.status,
      upload: { sessionUrl, chunkBytes: UPLOAD_CHUNK_BYTES },
    };
  }

  const videoId = parseYouTubeLink(request.link);
  if (!videoId) {
    throw new SoundcheckRejectedError(
      "invalid_link",
      "That isn't a link to a YouTube video. Paste the video's link from YouTube.",
    );
  }
  const doc: SoundcheckDoc = soundcheckDocSchema.parse({
    ...base,
    status: "queued",
    input: { kind: "youtube", videoId },
  });
  await ref.set(doc);
  try {
    await getWorkflowExecutions().createExecution({
      parent: workflow,
      execution: {
        argument: JSON.stringify({ channel_id: channelId, soundcheck_id: soundcheckId }),
      },
    });
  } catch (error) {
    await ref.set(
      soundcheckDocSchema.parse({
        ...doc,
        status: "failed",
        error: { code: "internal", message: "Something went wrong on our side. Please try again." },
        updatedAt: new Date().toISOString(),
      }),
    );
    throw error;
  }
  soundcheckLog.info({ kind: "youtube" }, "soundcheck queued");
  return { soundcheckId, status: doc.status, upload: null };
}

/** How many soundchecks the list shows, newest first. */
export const SOUNDCHECK_LIST_LIMIT = 30;

/** A channel's soundchecks, newest first; someone else's channel is a 404. */
export async function listSoundchecks(userId: string, channelId: string): Promise<SoundcheckDoc[]> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  const [, documents] = await Promise.all([
    requireChannel(userId, channelId),
    readCollection(soundcheckPaths(channelId).soundchecks, {
      orderBy: "createdAt",
      limit: SOUNDCHECK_LIST_LIMIT,
    }),
  ]);
  return documents.map((document) => soundcheckDocSchema.parse(document));
}

/** One soundcheck of a channel the user owns; a malformed ID or a missing one is a 404. */
export async function getSoundcheck(
  userId: string,
  channelId: string,
  soundcheckId: string,
): Promise<SoundcheckDoc> {
  if (!channelIdSchema.safeParse(channelId).success) throw new NotFoundError("channel");
  if (!soundcheckIdSchema.safeParse(soundcheckId).success) {
    await requireChannel(userId, channelId);
    throw new NotFoundError("soundcheck");
  }
  const [, data] = await Promise.all([
    requireChannel(userId, channelId),
    readDocument(soundcheckPaths(channelId).soundcheck(soundcheckId)),
  ]);
  if (data === undefined) throw new NotFoundError("soundcheck");
  return soundcheckDocSchema.parse(data);
}
