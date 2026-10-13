import { pickServerEnv } from "../env";
import { getStorage } from "../gcp";
import { channelIdSchema } from "../schemas";

/** One path segment: letters, digits, `_`, `-` and `.`, never `.` or `..` alone. */
const SEGMENT = /^(?!\.{1,2}$)[\w.-]+$/;

export interface RawResponse {
  channelId: string;
  /** The raw bucket unless given (soundchecks archive in the uploads bucket). */
  bucket?: string;
  /** The API and call, e.g. `youtube-videos` or `analytics-stats`. */
  source: string;
  /** What the response covers within the source: a video ID, `page-001`, `batch-003`. */
  key: string;
  /** The response body exactly as the API returned it. */
  body: unknown;
  /** The request parameters, stored as object metadata so the call can be replayed. */
  request?: unknown;
  fetchedAt?: Date;
}

/** `{channelId}/{source}/{key}/{yyyymmdd}.json`; the date is the UTC fetch date. */
export function rawObjectName({
  channelId,
  source,
  key,
  fetchedAt = new Date(),
}: Pick<RawResponse, "channelId" | "source" | "key" | "fetchedAt">): string {
  channelIdSchema.parse(channelId);
  for (const segment of [source, key]) {
    if (!SEGMENT.test(segment)) throw new RangeError(`Invalid raw archive segment: ${segment}`);
  }
  const yyyymmdd = fetchedAt.toISOString().slice(0, 10).replaceAll("-", "");
  return `${channelId}/${source}/${key}/${yyyymmdd}.json`;
}

/**
 * Writes an API response to the raw bucket before it is parsed (CLAUDE.md
 * rule 6), so features can be rebuilt without fetching again. A same-day
 * re-run overwrites the same object. Returns the `gs://` URI.
 */
export async function archiveRaw(response: RawResponse): Promise<string> {
  const bucket = response.bucket ?? pickServerEnv(["GCS_RAW_BUCKET"]).GCS_RAW_BUCKET;
  const name = rawObjectName(response);
  await getStorage()
    .bucket(bucket)
    .file(name)
    .save(JSON.stringify(response.body), {
      resumable: false,
      contentType: "application/json",
      metadata: {
        metadata:
          response.request === undefined ? {} : { request: JSON.stringify(response.request) },
      },
    });
  return `gs://${bucket}/${name}`;
}
