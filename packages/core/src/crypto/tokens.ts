import { pickServerEnv } from "../env";
import { getKms } from "../gcp";

/**
 * Refresh tokens are encrypted with the KMS key `oauth-tokens`, binding the
 * owner's user ID as additional authenticated data: a ciphertext copied onto
 * another user's channel will not decrypt. Ciphertext is stored as base64.
 */

const keyName = (): string => pickServerEnv(["KMS_KEY_NAME"]).KMS_KEY_NAME;

export async function encryptRefreshToken(userId: string, refreshToken: string): Promise<string> {
  const [result] = await getKms().encrypt({
    name: keyName(),
    plaintext: Buffer.from(refreshToken, "utf8"),
    additionalAuthenticatedData: Buffer.from(userId, "utf8"),
  });
  if (!result.ciphertext) throw new Error("KMS returned no ciphertext");
  return Buffer.from(result.ciphertext).toString("base64");
}

export async function decryptRefreshToken(userId: string, ciphertext: string): Promise<string> {
  const [result] = await getKms().decrypt({
    name: keyName(),
    ciphertext: Buffer.from(ciphertext, "base64"),
    additionalAuthenticatedData: Buffer.from(userId, "utf8"),
  });
  if (!result.plaintext) throw new Error("KMS returned no plaintext");
  return Buffer.from(result.plaintext).toString("utf8");
}
