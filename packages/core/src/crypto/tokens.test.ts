import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "../env";
import { FakeKms } from "../fake-kms";
import { resetClients, setClientOverride } from "../gcp";
import { decryptRefreshToken, encryptRefreshToken } from "./tokens";

const KEY = "projects/p/locations/us-central1/keyRings/soundcheck/cryptoKeys/oauth-tokens";

describe("refresh token encryption", () => {
  let kms: FakeKms;

  beforeEach(() => {
    vi.stubEnv("KMS_KEY_NAME", KEY);
    kms = new FakeKms();
    setClientOverride("kms", kms.asKms());
  });

  afterEach(() => {
    resetClients();
    vi.unstubAllEnvs();
    resetEnvCache();
  });

  it("encrypts with the oauth-tokens key and the user ID as AAD", async () => {
    const ciphertext = await encryptRefreshToken("user-1", "1//refresh-token");
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(Buffer.from(ciphertext, "base64").toString()).not.toContain("1//refresh-token");
    expect(kms.calls).toEqual([{ method: "encrypt", name: KEY, aad: "user-1" }]);
  });

  it("round-trips for the same user", async () => {
    const ciphertext = await encryptRefreshToken("user-1", "1//refresh-token");
    await expect(decryptRefreshToken("user-1", ciphertext)).resolves.toBe("1//refresh-token");
  });

  it("refuses to decrypt for a different user", async () => {
    const ciphertext = await encryptRefreshToken("user-1", "1//refresh-token");
    await expect(decryptRefreshToken("user-2", ciphertext)).rejects.toThrow(/INVALID_ARGUMENT/);
  });
});
