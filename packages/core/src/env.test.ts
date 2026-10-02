import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  EnvError,
  clientEnvSchema,
  getEnv,
  parseClientEnv,
  parseJobEnv,
  parseServerEnv,
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
  AUTH_SECRET: "auth-secret",
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
      MIN_VIEWS: 500,
      MIN_TRAIN_VIDEOS: 30,
      NEXT_PUBLIC_USE_FIXTURES: false,
    });
    expect(env.DEMO_CHANNEL_ID).toBeUndefined();
  });

  it("treats an empty assignment as unset", () => {
    const env = parseServerEnv({ ...requiredVars, GCP_REGION: "", DEMO_CHANNEL_ID: "" });
    expect(env.GCP_REGION).toBe("us-central1");
    expect(env.DEMO_CHANNEL_ID).toBeUndefined();
    expect(() => parseServerEnv({ ...requiredVars, GEMINI_MODEL: "" })).toThrow(/GEMINI_MODEL/);
  });

  it("coerces numbers and booleans", () => {
    const env = parseServerEnv({
      ...requiredVars,
      MIN_VIEWS: "1000",
      NEXT_PUBLIC_USE_FIXTURES: "true",
    });
    expect(env.MIN_VIEWS).toBe(1000);
    expect(env.NEXT_PUBLIC_USE_FIXTURES).toBe(true);
  });

  it("names every problem without echoing values", () => {
    const attempt = () =>
      parseServerEnv({ ...requiredVars, GCP_PROJECT_ID: undefined, MIN_VIEWS: "lots" });
    expect(attempt).toThrow(EnvError);
    expect(attempt).toThrow(/GCP_PROJECT_ID/);
    expect(attempt).toThrow(/MIN_VIEWS/);
    expect(attempt).not.toThrow(/client-secret|auth-secret/);
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
    expect(parseJobEnv({})).toEqual({ CLOUD_RUN_TASK_INDEX: 0, CLOUD_RUN_TASK_COUNT: 1 });
  });

  it("reads the Cloud Run task variables", () => {
    expect(parseJobEnv({ CLOUD_RUN_TASK_INDEX: "3", CLOUD_RUN_TASK_COUNT: "8" })).toEqual({
      CLOUD_RUN_TASK_INDEX: 3,
      CLOUD_RUN_TASK_COUNT: 8,
    });
  });

  it("rejects an index outside the task count", () => {
    expect(() => parseJobEnv({ CLOUD_RUN_TASK_INDEX: "2", CLOUD_RUN_TASK_COUNT: "2" })).toThrow(
      EnvError,
    );
  });
});
