import {
  pino,
  stdSerializers,
  stdTimeFunctions,
  type DestinationStream,
  type LevelWithSilent,
  type Logger,
} from "pino";

export type { Logger } from "pino";

/** pino level → Cloud Logging severity. */
const SEVERITY: Record<string, string> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

/**
 * Any key ending in token, secret or authorization (any case, optional plural)
 * is redacted at every depth: `refresh_token`, `clientSecret`, `headers.Authorization`.
 * Keys that only start with "token", such as Gemini's `totalTokenCount`, stay readable.
 */
const SENSITIVE_KEY = /(token|secret|authorization)s?$/i;
export const REDACTED = "[REDACTED]";

/**
 * Returns a copy of `value` with sensitive keys replaced by `REDACTED`. Errors
 * are serialized first so their enumerable fields (a GaxiosError's request
 * `config.headers`, for example) are scrubbed too. Objects with `toJSON` are
 * scrubbed in the shape they will be logged.
 */
export function redact(value: unknown, seen: WeakSet<object> = new WeakSet()): unknown {
  if (typeof value !== "object" || value === null) return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (value instanceof Error) return redact(stdSerializers.err(value), seen);
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  const toJSON = (value as { toJSON?: unknown }).toJSON;
  if (typeof toJSON === "function") return redact(toJSON.call(value), seen);
  // fromEntries defines own properties, so a "__proto__" key stays a plain key.
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(child, seen),
    ]),
  );
}

export interface LoggerOptions {
  level?: LevelWithSilent;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
}

/** JSON logs in Cloud Logging's structured format (`severity`, `message`, `time`). */
export function createLogger({ level = "info", destination }: LoggerOptions = {}): Logger {
  const options = {
    level,
    messageKey: "message",
    base: undefined,
    timestamp: stdTimeFunctions.isoTime,
    // `redact` already serialized every Error; pino's own err serializer would
    // run again afterwards and relabel the plain object as type "Object".
    serializers: { err: (value: unknown) => value },
    formatters: {
      level: (label: string) => ({ severity: SEVERITY[label] ?? "DEFAULT" }),
      log: (object: Record<string, unknown>) => redact(object) as Record<string, unknown>,
    },
  };
  return destination ? pino(options, destination) : pino(options);
}

export const logger: Logger = createLogger();

/** Context bound to every line a child logger writes. */
export interface LogContext {
  channel_id?: string;
  video_id?: string;
  stage?: string;
  run_id?: string;
  [key: string]: unknown;
}

/**
 * A logger that adds `context` to every line. Use this rather than `.child()`:
 * pino skips the bindings formatter for child loggers, so the context is
 * redacted here. pino repeats a key bound twice in the JSON line, so keys the
 * parent already binds to the same value are left out; bind a different value
 * under a new key rather than rebinding one.
 */
export function childLogger(context: LogContext, parent: Logger = logger): Logger {
  const bound = parent.bindings();
  const fresh = Object.entries(redact(context) as LogContext).filter(
    ([key, value]) => bound[key] !== value,
  );
  return parent.child(Object.fromEntries(fresh));
}
