import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getStorage } from "@soundcheck/core";

/**
 * Reading an uploaded cut's length with ffprobe (Phase 14), straight from
 * Cloud Storage: ffprobe asks for byte ranges over HTTPS, so a 2 GB file is
 * never downloaded. The access token travels in a request header, never in
 * the URL, and errors carry ffprobe's message only, never the command line
 * (which holds the token).
 */

export interface ProbedFile {
  durationS: number;
  /** False for a file with sound but no picture, which Gemini cannot watch as a video. */
  hasVideo: boolean;
}

/** How long ffprobe may take: it reads only the container's index. */
const PROBE_TIMEOUT_MS = 60_000;

/** The HTTPS address of a `gs://bucket/object` URI, each path segment encoded. */
export function storageUrl(uri: string): string {
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) throw new RangeError(`Not a Cloud Storage URI: ${uri}`);
  const [, bucket, name] = match as unknown as [string, string, string];
  const path = name.split("/").map(encodeURIComponent).join("/");
  return `https://storage.googleapis.com/${encodeURIComponent(bucket)}/${path}`;
}

/** ffprobe's JSON (`-show_entries format=duration:stream=codec_type`), parsed. */
export function parseProbe(stdout: string): ProbedFile {
  const parsed = JSON.parse(stdout) as {
    format?: { duration?: string };
    streams?: Array<{ codec_type?: string }>;
  };
  const durationS = Number(parsed.format?.duration);
  if (!Number.isFinite(durationS) || durationS <= 0) {
    throw new RangeError("ffprobe found no duration in the file");
  }
  return {
    durationS,
    hasVideo: (parsed.streams ?? []).some((stream) => stream.codec_type === "video"),
  };
}

/** Runs ffprobe; separate so tests can replace it. */
export type RunProbe = (args: readonly string[], timeoutMs: number) => Promise<string>;

const execFileAsync = promisify(execFile);

/**
 * ffprobe's failure without the command line: Node's own message and `cmd`
 * repeat every argument, the access token included. Keeps ffprobe's last
 * line of stderr, which names what went wrong.
 */
export function probeError(error: unknown): Error {
  const { stderr, killed } = error as { stderr?: string; killed?: boolean };
  const detail = killed ? "timed out" : (stderr ?? "").trim().split("\n").at(-1) || "failed";
  return new Error(`ffprobe could not read the upload: ${detail}`);
}

const runFfprobe: RunProbe = async (args, timeoutMs) => {
  try {
    const { stdout } = await execFileAsync("ffprobe", [...args], {
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    throw probeError(error);
  }
};

/** An access token for Cloud Storage, from the job's own credentials. */
async function accessToken(): Promise<string> {
  const token = await getStorage().authClient.getAccessToken();
  if (!token) throw new Error("No access token for Cloud Storage");
  return token;
}

export async function probeUpload(
  uri: string,
  { run = runFfprobe, token = accessToken }: { run?: RunProbe; token?: () => Promise<string> } = {},
): Promise<ProbedFile> {
  const args = [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_entries",
    "format=duration:stream=codec_type",
    "-headers",
    `Authorization: Bearer ${await token()}\r\n`,
    storageUrl(uri),
  ];
  return parseProbe(await run(args, PROBE_TIMEOUT_MS));
}
