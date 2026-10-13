import { describe, expect, it, vi } from "vitest";
import { UploadError, keptBytes, uploadFile } from "./upload";

const SESSION = "https://storage.googleapis.com/upload/storage/v1/b/u/o?upload_id=abc";
const file = new Blob([new Uint8Array(10)]);

/** A session that keeps what it is sent, answering as Cloud Storage does. */
function session({ failOn = new Set<number>() }: { failOn?: Set<number> } = {}) {
  let kept = 0;
  let call = 0;
  const calls: string[] = [];
  const send = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    call += 1;
    const range = new Headers(init?.headers).get("Content-Range") ?? "";
    calls.push(range);
    if (failOn.has(call)) throw new TypeError("Failed to fetch");
    const status = /^bytes \*\/(\d+)$/.exec(range);
    const total = Number(range.split("/")[1]);
    if (!status) {
      const [, first, last] = /^bytes (\d+)-(\d+)\//.exec(range) ?? [];
      if (Number(first) !== kept) return new Response(null, { status: 503 });
      kept = Number(last) + 1;
    }
    if (kept >= total) return new Response(null, { status: 200 });
    return new Response(null, {
      status: 308,
      headers: kept ? { Range: `bytes=0-${kept - 1}` } : {},
    });
  });
  return { send: send as unknown as typeof fetch, calls };
}

describe("keptBytes", () => {
  it("reads what the session kept", () => {
    expect(keptBytes("bytes=0-8388607")).toBe(8_388_608);
    expect(keptBytes(null)).toBeNull();
    expect(keptBytes("bytes=5-9")).toBeNull();
  });
});

describe("uploadFile", () => {
  it("sends the file in chunks and reports progress", async () => {
    const { send, calls } = session();
    const progress: number[] = [];
    await uploadFile(file, SESSION, {
      chunkBytes: 4,
      fetch: send,
      onProgress: (n) => progress.push(n),
    });
    expect(calls).toEqual(["bytes 0-3/10", "bytes 4-7/10", "bytes 8-9/10"]);
    expect(progress).toEqual([4, 8, 10]);
  });

  it("asks how much arrived after a dropped chunk, and carries on from there", async () => {
    const { send, calls } = session({ failOn: new Set([2]) });
    await uploadFile(file, SESSION, { chunkBytes: 4, fetch: send, backoffMs: 0 });
    expect(calls).toEqual([
      "bytes 0-3/10",
      "bytes 4-7/10",
      "bytes */10",
      "bytes 4-7/10",
      "bytes 8-9/10",
    ]);
  });

  it("gives up after too many failures in a row", async () => {
    const send = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    await expect(
      uploadFile(file, SESSION, { chunkBytes: 4, fetch: send, backoffMs: 0, attempts: 3 }),
    ).rejects.toMatchObject({ reason: "failed" });
  });

  it("stops at once when the session expired or refused the upload", async () => {
    const expired = vi.fn(
      async () => new Response(null, { status: 410 }),
    ) as unknown as typeof fetch;
    await expect(
      uploadFile(file, SESSION, { chunkBytes: 4, fetch: expired }),
    ).rejects.toMatchObject({
      reason: "expired",
    });
    const refused = vi.fn(
      async () => new Response(null, { status: 400 }),
    ) as unknown as typeof fetch;
    await expect(
      uploadFile(file, SESSION, { chunkBytes: 4, fetch: refused }),
    ).rejects.toBeInstanceOf(UploadError);
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("stops when the creator cancels", async () => {
    const controller = new AbortController();
    const send = vi.fn(async () => {
      controller.abort(new DOMException("Cancelled", "AbortError"));
      throw new DOMException("Cancelled", "AbortError");
    }) as unknown as typeof fetch;
    await expect(
      uploadFile(file, SESSION, { chunkBytes: 4, fetch: send, signal: controller.signal }),
    ).rejects.toThrow("Cancelled");
    expect(send).toHaveBeenCalledTimes(1);
  });
});
