/**
 * In-memory stand-in for the KMS encrypt/decrypt calls, for unit tests.
 * Ciphertexts are random bytes, so plaintext never appears inside them, and
 * decrypt enforces the additional authenticated data like real KMS does.
 */
import { randomBytes } from "node:crypto";
import type { KeyManagementServiceClient } from "@google-cloud/kms";

interface Sealed {
  keyName: string;
  plaintext: Buffer;
  aad: Buffer;
}

type Bytes = Uint8Array | string | null | undefined;
const bytes = (value: Bytes): Buffer => Buffer.from(value ?? "");

export class FakeKms {
  readonly calls: Array<{ method: "encrypt" | "decrypt"; name: string; aad: string }> = [];
  private readonly sealed = new Map<string, Sealed>();

  async encrypt(request: {
    name?: string | null;
    plaintext?: Bytes;
    additionalAuthenticatedData?: Bytes;
  }) {
    const name = request.name ?? "";
    const aad = bytes(request.additionalAuthenticatedData);
    this.calls.push({ method: "encrypt", name, aad: aad.toString() });
    const ciphertext = randomBytes(48);
    this.sealed.set(ciphertext.toString("hex"), {
      keyName: name,
      plaintext: bytes(request.plaintext),
      aad,
    });
    return [{ ciphertext }] as const;
  }

  async decrypt(request: {
    name?: string | null;
    ciphertext?: Bytes;
    additionalAuthenticatedData?: Bytes;
  }) {
    const name = request.name ?? "";
    const aad = bytes(request.additionalAuthenticatedData);
    this.calls.push({ method: "decrypt", name, aad: aad.toString() });
    const entry = this.sealed.get(bytes(request.ciphertext).toString("hex"));
    if (!entry || entry.keyName !== name || !entry.aad.equals(aad)) {
      throw Object.assign(new Error("3 INVALID_ARGUMENT: Decryption failed"), { code: 3 });
    }
    return [{ plaintext: entry.plaintext }] as const;
  }

  asKms(): KeyManagementServiceClient {
    return this as unknown as KeyManagementServiceClient;
  }
}
