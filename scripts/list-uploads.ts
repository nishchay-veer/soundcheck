/**
 * Phase 02 check: lists a connected channel's five latest uploads through the
 * pipeline's credentials path (KMS-decrypted refresh token + OAuth client from
 * Secret Manager). Uses Application Default Credentials for Google Cloud.
 *
 *   pnpm --filter @soundcheck/scripts list-uploads <CHANNEL_ID>
 */
import { NotFoundError, ReauthRequiredError, withRetry } from "@soundcheck/core";
import { loadChannel } from "@soundcheck/core/data";
import { channelIdSchema } from "@soundcheck/core/schemas";
import { credentialsForChannel, parsePlaylistItems, youtubeClient } from "@soundcheck/core/youtube";

const channelId = process.argv[2] ?? "";
if (!channelIdSchema.safeParse(channelId).success) {
  process.stderr.write("Usage: list-uploads <CHANNEL_ID>  (a UC… channel ID from Firestore)\n");
  process.exit(2);
}

try {
  const channel = await loadChannel(channelId);
  const auth = await credentialsForChannel(channelId);
  const response = await withRetry(
    () =>
      youtubeClient(auth).playlistItems.list({
        part: ["snippet", "contentDetails"],
        playlistId: channel.uploadsPlaylistId,
        maxResults: 5,
      }),
    { operation: "youtube.playlistItems.list" },
  );

  process.stdout.write(`${channel.title} (${channelId}), five latest uploads:\n`);
  for (const video of parsePlaylistItems(response.data)) {
    process.stdout.write(
      `  ${video.publishedAt?.slice(0, 10) ?? "unpublished"}  ${video.videoId}  ${video.title}\n`,
    );
  }
} catch (error) {
  if (error instanceof NotFoundError) {
    process.stderr.write(`No connected channel ${channelId} in Firestore.\n`);
  } else if (error instanceof ReauthRequiredError) {
    process.stderr.write(
      `Channel ${channelId} must be reconnected: sign in again on the web app.\n`,
    );
  } else {
    throw error;
  }
  process.exitCode = 1;
}
