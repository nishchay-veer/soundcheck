import { Storage } from "@google-cloud/storage";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "./env";
import { getBigQuery, getFirestore, getStorage, resetClients, setClientOverride } from "./gcp";

describe("gcp clients", () => {
  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("returns an override without constructing a client or reading env", () => {
    // No env is stubbed, so constructing a real client would throw EnvError.
    const fake = { kind: "fake-bigquery" } as unknown as ReturnType<typeof getBigQuery>;
    setClientOverride("bigquery", fake);
    expect(getBigQuery()).toBe(fake);
  });

  it("removes an override", () => {
    const fake = {} as ReturnType<typeof getFirestore>;
    setClientOverride("firestore", fake);
    setClientOverride("firestore", undefined);
    expect(() => getFirestore()).toThrow(/Invalid server environment/);
  });

  it("constructs each client once, on first use", () => {
    vi.stubEnv("GCP_PROJECT_ID", "soundcheck-test");
    for (const name of [
      "GCS_RAW_BUCKET",
      "GCS_UPLOADS_BUCKET",
      "GCS_MEDIA_BUCKET",
      "KMS_KEY_NAME",
      "AUTH_GOOGLE_ID",
      "AUTH_GOOGLE_SECRET",
      "AUTH_SECRET",
      "GEMINI_MODEL",
      "GEMINI_FLASH_MODEL",
      "IMAGEN_MODEL",
      "WORKFLOW_CHANNEL_BUILD",
      "WORKFLOW_SOUNDCHECK",
    ]) {
      vi.stubEnv(name, "x");
    }

    const storage = getStorage();
    expect(storage).toBeInstanceOf(Storage);
    expect(storage.projectId).toBe("soundcheck-test");
    expect(getStorage()).toBe(storage);

    resetClients();
    expect(getStorage()).not.toBe(storage);
  });
});
