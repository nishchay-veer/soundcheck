import { OAuth2Client } from "google-auth-library";
import type { Logger } from "pino";
import { decryptRefreshToken } from "../crypto/tokens";
import { loadChannel } from "../data/channels";
import { ReauthRequiredError } from "../errors";
import { getFirestore } from "../gcp";
import { childLogger, logger as rootLogger } from "../logger";
import { withRetry } from "../retry";
import { COLLECTIONS } from "../schemas";
import { SECRET_NAMES, readSecret } from "../secrets";

/** Google answers a revoked or expired refresh token with HTTP 400 `invalid_grant`. */
function isInvalidGrant(error: unknown): boolean {
  const { response, message } = error as {
    response?: { data?: { error?: unknown } };
    message?: unknown;
  };
  return (
    response?.data?.error === "invalid_grant" ||
    (typeof message === "string" && message.includes("invalid_grant"))
  );
}

/**
 * YouTube credentials for a connected channel, for pipeline jobs. Decrypts the
 * stored refresh token, reads the OAuth client from Secret Manager and forces a
 * refresh so a dead token fails here rather than mid-job. When Google rejects
 * the token, the channel is marked `reauth_required` and ReauthRequiredError is
 * thrown; the creator has to reconnect.
 *
 * No ownership check: jobs act for the channel. Route handlers must call
 * requireChannel() before anything that leads here.
 */
export async function credentialsForChannel(
  channelId: string,
  log: Logger = rootLogger,
): Promise<OAuth2Client> {
  const channel = await loadChannel(channelId);
  if (channel.status === "reauth_required") throw new ReauthRequiredError(channelId);

  const [refreshToken, clientId, clientSecret] = await Promise.all([
    decryptRefreshToken(channel.userId, channel.tokenCiphertext),
    readSecret(SECRET_NAMES.oauthClientId),
    readSecret(SECRET_NAMES.oauthClientSecret),
  ]);
  const client = new OAuth2Client({ clientId, clientSecret });
  client.setCredentials({ refresh_token: refreshToken });

  try {
    await withRetry(() => client.getAccessToken(), {
      operation: "oauth2.refreshAccessToken",
      logger: log,
    });
  } catch (error) {
    if (!isInvalidGrant(error)) throw error;
    await getFirestore()
      .collection(COLLECTIONS.channels)
      .doc(channelId)
      .update({ status: "reauth_required" });
    childLogger({ channel_id: channelId, stage: "auth" }, log).warn(
      "refresh token rejected by Google; the channel must be reconnected",
    );
    throw new ReauthRequiredError(channelId);
  }
  return client;
}
