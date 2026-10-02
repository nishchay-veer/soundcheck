import pRetry from "p-retry";
import type { Logger } from "pino";
import { logger as defaultLogger } from "./logger";

/** Rule 5: no external call is attempted more than six times. */
export const MAX_ATTEMPTS = 6;

const GRPC_RESOURCE_EXHAUSTED = 8;
const GRPC_UNAVAILABLE = 14;

/**
 * HTTP status of a failed call: gaxios errors (googleapis, Google Cloud REST)
 * carry it on `response.status`; `@google/genai` ApiErrors carry it on `status`.
 */
function httpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { response, status } = error as { response?: { status?: unknown }; status?: unknown };
  if (typeof response?.status === "number") return response.status;
  if (typeof status === "number") return status;
  return undefined;
}

function grpcCode(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const { code } = error as { code?: unknown };
  return typeof code === "number" ? code : undefined;
}

/**
 * Retry only on HTTP 429 and 5xx, and on gRPC RESOURCE_EXHAUSTED (8) and
 * UNAVAILABLE (14). Everything else, including socket errors such as
 * ECONNRESET, fails immediately.
 */
export function isRetryable(error: unknown): boolean {
  const status = httpStatus(error);
  if (status !== undefined) return status === 429 || (status >= 500 && status <= 599);
  const code = grpcCode(error);
  return code === GRPC_RESOURCE_EXHAUSTED || code === GRPC_UNAVAILABLE;
}

export interface RetryOptions {
  /** Names the call in retry logs, e.g. "youtube.analytics.reports.query". */
  operation?: string;
  logger?: Logger;
  /** Total attempts including the first; capped at `MAX_ATTEMPTS`. */
  maxAttempts?: number;
  /** Delay before the first retry, before jitter. */
  minTimeoutMs?: number;
  maxTimeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Runs `fn`, retrying transient failures with exponential backoff
 * (factor 2, each delay multiplied by a random 1–2 for jitter). Logs a
 * warning before every retry and rethrows the last error.
 */
export function withRetry<T>(
  fn: (attempt: number) => PromiseLike<T> | T,
  options: RetryOptions = {},
): Promise<T> {
  const {
    operation = "external call",
    logger = defaultLogger,
    maxAttempts = MAX_ATTEMPTS,
    minTimeoutMs = 1_000,
    maxTimeoutMs = 30_000,
    signal,
  } = options;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError(`maxAttempts must be a positive integer, got ${maxAttempts}`);
  }
  return pRetry(fn, {
    retries: Math.min(maxAttempts, MAX_ATTEMPTS) - 1,
    factor: 2,
    minTimeout: minTimeoutMs,
    maxTimeout: maxTimeoutMs,
    randomize: true,
    signal,
    shouldRetry: ({ error, attemptNumber, retriesLeft, retryDelay }) => {
      if (!isRetryable(error)) return false;
      logger.warn(
        {
          operation,
          attempt: attemptNumber,
          retries_left: retriesLeft,
          delay_ms: Math.round(retryDelay),
          err: error,
        },
        `${operation} failed; retrying`,
      );
      return true;
    },
  });
}
