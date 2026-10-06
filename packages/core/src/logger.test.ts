import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { REDACTED, childLogger, createLogger, redact } from "./logger";
import { memoryLogger } from "./test-utils";

describe("logger", () => {
  it("writes Cloud Logging fields: severity, message, time", () => {
    const { lines, logger } = memoryLogger();
    logger.info({ stage: "ingest" }, "hello");

    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line).toMatchObject({ severity: "INFO", message: "hello", stage: "ingest" });
    expect(line).not.toHaveProperty("msg");
    expect(line).not.toHaveProperty("level");
    expect(line).not.toHaveProperty("pid");
    expect(new Date(String(line?.time)).toISOString()).toBe(line?.time);
  });

  it("maps every pino level to a Cloud Logging severity", () => {
    const { lines, logger } = memoryLogger();
    logger.debug("d");
    logger.info("i");
    logger.warn("w");
    logger.error("e");
    logger.fatal("f");
    expect(lines.map((line) => line.severity)).toEqual([
      "DEBUG",
      "INFO",
      "WARNING",
      "ERROR",
      "CRITICAL",
    ]);
  });

  it("redacts keys ending in token, secret or authorization at any depth", () => {
    const { lines, logger } = memoryLogger();
    logger.info({
      refresh_token: "r",
      user: { accessToken: "a", tokens: { id_token: "i" } },
      headers: { Authorization: "Bearer b" },
      oauth: { clientSecret: "c", AUTH_GOOGLE_SECRET: "g" },
      usageMetadata: { totalTokenCount: 12, promptTokenCount: 3 },
      token_type: "Bearer",
    });

    expect(lines[0]).toMatchObject({
      refresh_token: REDACTED,
      user: { accessToken: REDACTED, tokens: REDACTED },
      headers: { Authorization: REDACTED },
      oauth: { clientSecret: REDACTED, AUTH_GOOGLE_SECRET: REDACTED },
      usageMetadata: { totalTokenCount: 12, promptTokenCount: 3 },
      token_type: "Bearer",
    });
  });

  it("keeps an error's message and stack but scrubs its request headers", () => {
    const { lines, logger } = memoryLogger();
    const err = Object.assign(new Error("request failed"), {
      config: { url: "https://example.test", headers: { authorization: "Bearer leaked" } },
    });
    logger.error({ err }, "call failed");

    const logged = lines[0]?.err as Record<string, unknown>;
    expect(logged).toMatchObject({
      type: "Error",
      message: "request failed",
      config: { url: "https://example.test", headers: { authorization: REDACTED } },
    });
    expect(logged.stack).toEqual(expect.stringContaining("request failed"));
  });

  it("serializes an Error passed as the only argument", () => {
    const { lines, logger } = memoryLogger();
    logger.error(new TypeError("bad input"));
    expect(lines[0]).toMatchObject({
      severity: "ERROR",
      message: "bad input",
      err: { type: "TypeError", message: "bad input" },
    });
  });

  it("binds context on child loggers and redacts it too", () => {
    const { lines, logger } = memoryLogger();
    const child = childLogger(
      { channel_id: "UC123", video_id: "v1", stage: "extract", run_id: "r1", api_token: "t" },
      logger,
    );
    child.info("bound");

    expect(lines[0]).toMatchObject({
      channel_id: "UC123",
      video_id: "v1",
      stage: "extract",
      run_id: "r1",
      api_token: REDACTED,
      message: "bound",
    });
  });

  it("does not repeat a key the parent already binds", () => {
    // Read the raw JSON: parsing it would hide a duplicate key.
    const raw: string[] = [];
    const root = createLogger({ destination: { write: (line: string) => raw.push(line) } });
    const parent = childLogger({ channel_id: "UC123", run_id: "r1" }, root);
    childLogger({ channel_id: "UC123", run_id: "r1", table: "videos" }, parent).info("x");

    expect(raw[0]?.match(/"channel_id"/g)).toHaveLength(1);
    expect(raw[0]?.match(/"run_id"/g)).toHaveLength(1);
    expect(JSON.parse(raw[0] ?? "")).toMatchObject({
      channel_id: "UC123",
      run_id: "r1",
      table: "videos",
    });
  });

  it("handles circular references", () => {
    const node: Record<string, unknown> = { name: "a" };
    node.self = node;
    expect(redact(node)).toEqual({ name: "a", self: "[Circular]" });
  });

  it("never lets a value under a sensitive key through, wherever it sits", () => {
    const secret = "s3cr3t-value";
    const sensitiveKey = fc.constantFrom(
      "token",
      "refreshToken",
      "ACCESS_TOKEN",
      "clientSecret",
      "secrets",
      "Authorization",
      "proxy-authorization",
    );
    const path = fc.array(fc.string({ minLength: 1, maxLength: 8 }), { maxLength: 5 });

    fc.assert(
      fc.property(fc.object(), path, sensitiveKey, (base, keys, key) => {
        const planted = keys.reduceRight<unknown>((inner, k) => ({ [k]: inner }), {
          [key]: secret,
        });
        expect(JSON.stringify(redact({ base, planted }))).not.toContain(secret);
      }),
    );
  });
});
