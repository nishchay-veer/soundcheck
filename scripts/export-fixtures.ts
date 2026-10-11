/**
 * Saves one channel's serving documents for fixtures mode (Phase 11), so the
 * screens can be built without Google Cloud: `NEXT_PUBLIC_USE_FIXTURES=true
 * pnpm dev` reads them instead of Firestore.
 *
 *   pnpm --filter @soundcheck/scripts export-fixtures --channel UC…
 *
 * Writes `apps/web/fixtures/<Firestore path>.json`: the channel (owned by the
 * fixture user, with no token), the fixture user, the summary, the video list
 * and every video page, each checked against its schema first. The documents
 * hold the channel's real analytics, so share the repo accordingly.
 */
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { getFirestore } from "@soundcheck/core";
import { FIXTURE_USER_ID, toFixture } from "@soundcheck/core/data";
import {
  COLLECTIONS,
  channelDocSchema,
  channelIdSchema,
  servingPaths,
  summaryDocSchema,
  userDocSchema,
  videoDocSchema,
  videoIndexDocSchema,
} from "@soundcheck/core/schemas";

const OUT = fileURLToPath(new URL("../apps/web/fixtures/", import.meta.url));

const { values } = parseArgs({ options: { channel: { type: "string" } } });
const channelId = channelIdSchema.parse(values.channel);
const db = getFirestore();
const paths = servingPaths(channelId);

async function read(path: string): Promise<unknown> {
  const snapshot = await db.doc(path).get();
  if (!snapshot.exists) throw new Error(`${path} does not exist: run "soundcheck publish" first`);
  return snapshot.data();
}

const channel = channelDocSchema.parse(await read(`${COLLECTIONS.channels}/${channelId}`));
const index = videoIndexDocSchema.parse(await read(paths.videoIndex));
const documents: Array<[string, unknown]> = [
  [
    `${COLLECTIONS.channels}/${channelId}`,
    channelDocSchema.parse({
      ...channel,
      userId: FIXTURE_USER_ID,
      // Never the real token, even encrypted.
      tokenCiphertext: "fixture",
      tokenScope: "",
      build: { ...channel.build, execution: undefined },
    }),
  ],
  [
    `${COLLECTIONS.users}/${FIXTURE_USER_ID}`,
    userDocSchema.parse({
      email: "fixture@example.com",
      channelIds: [channelId],
      createdAt: channel.connectedAt,
      lastSignInAt: channel.connectedAt,
    }),
  ],
  [paths.summary, summaryDocSchema.parse(await read(paths.summary))],
  [paths.videoIndex, index],
];
for (const video of index.videos) {
  const path = paths.video(video.videoId);
  documents.push([path, videoDocSchema.parse(await read(path))]);
}

await rm(OUT, { recursive: true, force: true });
for (const [path, data] of documents) {
  const file = join(OUT, `${path}.json`);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(toFixture(data), null, 2)}\n`);
}
process.stdout.write(
  `Saved ${documents.length} documents for ${channelId} to apps/web/fixtures/\n`,
);
