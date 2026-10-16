import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  clientEnvSchema,
  getEnv,
  parseClientEnv,
  parseJobEnv,
  parseServerEnv,
  pickServerEnv,
  resetEnvCache,
  serverEnvSchema,
} from "./env";

const requiredVars = {
  GCP_PROJECT_ID: "soundcheck-test",
  GCS_RAW_BUCKET: "soundcheck-test-raw",
  GCS_UPLOADS_BUCKET: "soundcheck-test-uploads",
  GCS_MEDIA_BUCKET: "soundcheck-test-media",
  KMS_KEY_NAME: "projects/p/locations/us-central1/keyRings/r/cryptoKeys/k",
  AUTH_GOOGLE_ID: "client-id",
  AUTH_GOOGLE_SECRET: "client-secret",
  AUTH_SECRET: "auth-secret-value-at-least-32-characters",
  GEMINI_MODEL: "gemini-model",
  GEMINI_FLASH_MODEL: "gemini-flash-model",
  IMAGEN_MODEL: "imagen-model",
  WORKFLOW_CHANNEL_BUILD: "channel_build",
  WORKFLOW_SOUNDCHECK: "soundcheck",
};

describe("server env", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("covers exactly the variables in .env.example", () => {
    const example = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const names = example
      .split("\n")
      .filter((line) => /^[A-Z_]+=/.test(line))
      .map((line) => line.slice(0, line.indexOf("=")));
    expect(Object.keys(serverEnvSchema.shape).sort()).toEqual(names.sort());
  });

  it("applies the documented defaults", () => {
    const env = parseServerEnv(requiredVars);
    expect(env).toMatchObject({
      GCP_REGION: "us-central1",
      BQ_DATASET: "soundcheck",
      BQ_LOCATION: "US",
      FIRESTORE_DATABASE: "(default)",
      GEMINI_LOCATION: "global",
      MIN_VIEWS: 0,
      MIN_TRAIN_VIDEOS: 20,
      NEXT_PUBLIC_USE_FIXTURES: false,
    });
    expect(env.DEMO_CHANNEL_ID).toBeUndefined();
  });

  it("does not require variables for phases that are not built yet", () => {
    const later = ["IMAGEN_MODEL", "WORKFLOW_CHANNEL_BUILD", "WORKFLOW_SOUNDCHECK"];
    const env = parseServerEnv(
      Object.fromEntries(Object.entries(requiredVars).filter(([name]) => !later.includes(name))),
    );
    expect(env.IMAGEN_MODEL).toBeUndefined();
    expect(env.WORKFLOW_CHANNEL_BUILD).toBeUndefined();
    expect(env.WORKFLOW_SOUNDCHECK).toBeUndefined();
  });

  it("treats an empty assignment as unset", () => {
    const env = parseServerEnv({ ...requiredVars, GCP_REGION: "", DEMO_CHANNEL_ID: "" });
    expect(env.GCP_REGION).toBe("us-central1");
    expect(env.DEMO_CHANNEL_ID).toBeUndefined();
    expect(() => parseServerEnv({ ...requiredVars, GEMINI_MODEL: "" })).toThrow(/GEMINI_MODEL/);
  });

  it("rejects a placeholder AUTH_SECRET", () => {
    expect(() => parseServerEnv({ ...requiredVars, AUTH_SECRET: "x" })).toThrow(/at least 32/);
  });

  it("coerces numbers and booleans", () => {
    const env = parseServerEnv({
      ...requiredVars,
      MIN_VIEWS: "1000",
      NEXT_PUBLIC_USE_FIXTURES: "true",
    });
    expect(env.MIN_VIEWS).toBe(1000);
    // No views floor at all is allowed.
    expect(parseServerEnv({ ...requiredVars, MIN_VIEWS: "0" }).MIN_VIEWS).toBe(0);
    expect(env.NEXT_PUBLIC_USE_FIXTURES).toBe(true);
  });

  it("names every problem without echoing values", () => {
    const attempt = () =>
      parseServerEnv({ ...requiredVars, GCP_PROJECT_ID: undefined, MIN_VIEWS: "lots" });
    expect(attempt).toThrow(EnvError);
    expect(attempt).toThrow(/GCP_PROJECT_ID/);
    expect(attempt).toThrow(/MIN_VIEWS/);
    expect(attempt).not.toThrow(/client-secret|auth-secret-value/);
  });

  it("parses process.env once and caches the result", () => {
    for (const [name, value] of Object.entries(requiredVars)) vi.stubEnv(name, value);
    const first = getEnv();
    vi.stubEnv("GCP_PROJECT_ID", "changed");
    expect(getEnv()).toBe(first);
    resetEnvCache();
    expect(getEnv().GCP_PROJECT_ID).toBe("changed");
  });
});

describe("pickServerEnv", () => {
  it("validates only the requested variables", () => {
    const env = pickServerEnv(["GCP_PROJECT_ID", "GEMINI_LOCATION", "GEMINI_MODEL"], {
      GCP_PROJECT_ID: "soundcheck-test",
      GEMINI_MODEL: "gemini-model",
    });
    expect(env).toEqual({
      GCP_PROJECT_ID: "soundcheck-test",
      GEMINI_LOCATION: "global",
      GEMINI_MODEL: "gemini-model",
    });
  });

  it("still rejects a requested variable that is missing", () => {
    expect(() => pickServerEnv(["GEMINI_MODEL"], {})).toThrow(/GEMINI_MODEL/);
  });
});

describe("client env", () => {
  it("only contains NEXT_PUBLIC_ variables", () => {
    for (const name of Object.keys(clientEnvSchema.shape)) {
      expect(name).toMatch(/^NEXT_PUBLIC_/);
    }
  });

  it("defaults fixtures off", () => {
    expect(parseClientEnv({})).toEqual({ NEXT_PUBLIC_USE_FIXTURES: false });
  });
});

describe("job env", () => {
  it("defaults to a single task", () => {
    expect(parseJobEnv({})).toEqual({
      CLOUD_RUN_TASK_INDEX: 0,
      CLOUD_RUN_TASK_COUNT: 1,
      BUILD_MODE: "build",
    });
  });

  it("reads the Cloud Run task variables", () => {
    expect(parseJobEnv({ CLOUD_RUN_TASK_INDEX: "3", CLOUD_RUN_TASK_COUNT: "8" })).toEqual({
      CLOUD_RUN_TASK_INDEX: 3,
      CLOUD_RUN_TASK_COUNT: 8,
      BUILD_MODE: "build",
    });
  });

  it("rejects an index outside the task count", () => {
    expect(() => parseJobEnv({ CLOUD_RUN_TASK_INDEX: "2", CLOUD_RUN_TASK_COUNT: "2" })).toThrow(
      EnvError,
    );
  });
});
