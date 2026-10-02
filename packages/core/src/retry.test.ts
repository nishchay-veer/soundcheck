import { describe, expect, it, vi } from "vitest";
import { MAX_ATTEMPTS, isRetryable, withRetry } from "./retry";
import { memoryLogger } from "./test-utils";

const gaxiosError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { response: { status } });
const genaiError = (status: number) => Object.assign(new Error(`ApiError ${status}`), { status });
const grpcError = (code: number) => Object.assign(new Error(`gRPC ${code}`), { code });
const socketError = () => Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });

const fast = { minTimeoutMs: 0, maxTimeoutMs: 0 };

describe("isRetryable", () => {
  it.each([
    ["gaxios 429", gaxiosError(429)],
    ["gaxios 500", gaxiosError(500)],
    ["gaxios 503", gaxiosError(503)],
    ["genai 429", genaiError(429)],
    ["genai 504", genaiError(504)],
    ["gRPC RESOURCE_EXHAUSTED", grpcError(8)],
    ["gRPC UNAVAILABLE", grpcError(14)],
  ])("retries %s", (_, error) => {
    expect(isRetryable(error)).toBe(true);
  });

  it.each([
    ["gaxios 400", gaxiosError(400)],
    ["gaxios 403", gaxiosError(403)],
    ["genai 404", genaiError(404)],
    ["gRPC NOT_FOUND", grpcError(5)],
    ["gRPC DEADLINE_EXCEEDED", grpcError(4)],
    ["ECONNRESET", socketError()],
    ["plain Error", new Error("boom")],
    ["string", "boom"],
    ["null", null],
  ])("does not retry %s", (_, error) => {
    expect(isRetryable(error)).toBe(false);
  });
});

describe("withRetry", () => {
  it("retries transient failures, then returns the result", async () => {
    const { lines, logger } = memoryLogger();
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(gaxiosError(429))
      .mockRejectedValueOnce(grpcError(14))
      .mockResolvedValue("ok");

    await expect(withRetry(fn, { ...fast, logger, operation: "test.call" })).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(3);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      severity: "WARNING",
      message: "test.call failed; retrying",
      operation: "test.call",
      attempt: 1,
    });
  });

  it("aborts on a non-retryable error without logging a retry", async () => {
    const { lines, logger } = memoryLogger();
    const fn = vi.fn().mockRejectedValue(gaxiosError(404));

    await expect(withRetry(fn, { ...fast, logger })).rejects.toThrow("HTTP 404");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(lines).toHaveLength(0);
  });

  it("gives up after six attempts", async () => {
    const { logger } = memoryLogger();
    const fn = vi.fn().mockRejectedValue(genaiError(503));

    await expect(withRetry(fn, { ...fast, logger })).rejects.toThrow("ApiError 503");
    expect(fn).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("never exceeds six attempts even when asked to", async () => {
    const { logger } = memoryLogger();
    const fn = vi.fn().mockRejectedValue(gaxiosError(500));

    await expect(withRetry(fn, { ...fast, logger, maxAttempts: 20 })).rejects.toThrow();
    expect(fn).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it("passes the attempt number to the function", async () => {
    const { logger } = memoryLogger();
    const seen: number[] = [];
    await withRetry(
      (attempt) => {
        seen.push(attempt);
        if (attempt < 3) throw gaxiosError(502);
        return attempt;
      },
      { ...fast, logger },
    );
    expect(seen).toEqual([1, 2, 3]);
  });

  it("redacts credentials on the logged error", async () => {
    const { lines, logger } = memoryLogger();
    const error = Object.assign(gaxiosError(500), {
      config: { headers: { Authorization: "Bearer ya29.secret" } },
    });
    const fn = vi.fn().mockRejectedValueOnce(error).mockResolvedValue(1);

    await withRetry(fn, { ...fast, logger });
    expect(JSON.stringify(lines)).not.toContain("ya29.secret");
  });
});
