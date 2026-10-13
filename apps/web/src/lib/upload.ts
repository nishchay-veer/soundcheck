/**
 * Sending a file to a Cloud Storage resumable upload session from the browser
 * (Phase 14), in chunks, so a 2 GB file shows its progress and survives a
 * dropped connection: after a failed chunk, the session is asked how much
 * arrived and the upload carries on from there.
 *
 * Protocol: each chunk is a PUT with `Content-Range: bytes first-last/total`.
 * 308 means "send more" and `Range: bytes=0-n` says what was kept; 200 or 201
 * means the file is complete. A status check is an empty PUT with
 * `Content-Range: bytes * /total`. 404 or 410 means the session expired.
 */

export class UploadError extends Error {
  constructor(
    readonly reason: "expired" | "rejected" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

/** The byte after the last one kept, from a 308's `Range: bytes=0-n`; null without the header. */
export function keptBytes(range: string | null): number | null {
  const match = range ? /^bytes=0-(\d+)$/.exec(range.trim()) : null;
  return match ? Number(match[1]) + 1 : null;
}

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    });
  });

export interface UploadOptions {
  chunkBytes: number;
  /** Bytes the session has kept so far. */
  onProgress?: (sent: number) => void;
  signal?: AbortSignal;
  /** Failed requests in a row before giving up. */
  attempts?: number;
  /** The first wait after a failure; it doubles each time. */
  backoffMs?: number;
  fetch?: typeof fetch;
}

export async function uploadFile(
  file: Blob,
  sessionUrl: string,
  {
    chunkBytes,
    onProgress,
    signal,
    attempts = 6,
    backoffMs = 1_000,
    fetch: send = fetch,
  }: UploadOptions,
): Promise<void> {
  const total = file.size;
  let offset = 0;
  let failures = 0;

  /** After a failure: how much the session kept, or that it already has everything. */
  async function resume(): Promise<number | "complete"> {
    const response = await send(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes */${total}` },
      signal,
    });
    if (response.status === 200 || response.status === 201) return "complete";
    if (response.status === 404 || response.status === 410) {
      throw new UploadError("expired", "The upload expired. Please start again.");
    }
    if (response.status !== 308) throw new Error(`Status check failed: ${response.status}`);
    return keptBytes(response.headers.get("Range")) ?? 0;
  }

  while (offset < total) {
    const end = Math.min(offset + chunkBytes, total);
    try {
      const response = await send(sessionUrl, {
        method: "PUT",
        headers: { "Content-Range": `bytes ${offset}-${end - 1}/${total}` },
        body: file.slice(offset, end),
        signal,
      });
      if (response.status === 200 || response.status === 201) {
        onProgress?.(total);
        return;
      }
      if (response.status === 308) {
        // Chunks are multiples of 256 KiB, so a whole chunk is kept unless the
        // session says otherwise.
        offset = keptBytes(response.headers.get("Range")) ?? end;
        failures = 0;
        onProgress?.(offset);
        continue;
      }
      if (response.status === 404 || response.status === 410) {
        throw new UploadError("expired", "The upload expired. Please start again.");
      }
      if (response.status < 500 && response.status !== 429) {
        throw new UploadError("rejected", `The upload was refused (${response.status}).`);
      }
      throw new Error(`Chunk failed: ${response.status}`);
    } catch (error) {
      if (signal?.aborted || error instanceof UploadError) throw error;
      failures += 1;
      if (failures >= attempts) {
        throw new UploadError(
          "failed",
          "The upload kept failing. Check your connection and try again.",
        );
      }
      await wait(backoffMs * 2 ** (failures - 1), signal);
      try {
        const kept = await resume();
        if (kept === "complete") {
          onProgress?.(total);
          return;
        }
        offset = kept;
        onProgress?.(offset);
      } catch (statusError) {
        if (statusError instanceof UploadError) throw statusError;
        // The status check failed too: try the same chunk again.
      }
    }
  }
}
