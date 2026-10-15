import { createHash, randomUUID } from "node:crypto";
import {
  PUBLISH_VERSION,
  childLogger,
  getFirestore,
  logger as rootLogger,
  type Logger,
} from "@soundcheck/core";
import { narrate, type Narration } from "@soundcheck/core/gemini";
import { isStepDone, markStepDone } from "@soundcheck/core/jobs";
import {
  COLLECTIONS,
  servingPaths,
  type SummaryDoc,
  type VideoDoc,
  type VideoIndexDoc,
} from "@soundcheck/core/schemas";
import pLimit from "p-limit";
import { computeTraits, type TraitsResult } from "../traits/run";
import { assemble, finalize } from "./assemble";
import { readPublishInputs, type PublishInputs } from "./read";

/**
 * `soundcheck publish` (Phase 11, run as `job-publish`): precomputes every
 * screen of a channel into Firestore.
 *
 * Reads the catalogue, stats, curves, beats, the latest fitted models and
 * the latest held-out evaluation; predicts every video's bands; finds and
 * attributes drop-offs; narrates them; checks each document's schema; and
 * writes the video pages, the video list and the summary, in batches of at
 * most 500 writes, removing pages of videos no longer published.
 *
 * A re-run whose documents would come out the same (apart from the run and
 * time) writes nothing (rule 7); captions come from the narration cache.
 */

export const PUBLISH_STEP = "publish";
/** Firestore's limit on writes per batch. */
const BATCH_WRITES = 500;
/** Narration batches in flight at once. */
const NARRATION_CONCURRENCY = 4;

export interface PublishResult {
  channelId: string;
  runId: string;
  videos: number;
  drops: number;
  /** Captions that fell back to their templates. */
  templated: number;
  /** False when nothing changed since the last publish. */
  written: boolean;
  /** Pages of videos no longer published. */
  deleted: number;
  /** True when the models are not usable: every screen must say so. */
  notUsable: boolean;
}

interface Documents {
  summary: SummaryDoc;
  index: VideoIndexDoc;
  videos: VideoDoc[];
}

/** A hash of the documents without their run ID and time, so an unchanged re-run matches. */
export function documentsFingerprint({ summary, index, videos }: Documents): string {
  const strip = (doc: { runId: string; generatedAt: string }) => ({
    ...doc,
    runId: undefined,
    generatedAt: undefined,
  });
  return createHash("sha256")
    .update(
      JSON.stringify({ summary: strip(summary), index: strip(index), videos: videos.map(strip) }),
    )
    .digest("hex")
    .slice(0, 32);
}

/** The latest curve date, or today when there are no curves. */
function asOfDate(inputs: PublishInputs, now: Date): string {
  const dates = [...inputs.features.curves.values()].flatMap((byAudience) =>
    [...byAudience.values()].flatMap((points) => points.map((point) => point.asOf)),
  );
  return dates.sort().at(-1) ?? now.toISOString().slice(0, 10);
}

/** Writes the documents in batches, pages first, then the list and the summary; returns pages removed. */
async function writeDocuments(channelId: string, documents: Documents): Promise<number> {
  const db = getFirestore();
  const paths = servingPaths(channelId);
  const published = new Set(documents.videos.map((video) => video.videoId));
  const existing = await db
    .collection(COLLECTIONS.channels)
    .doc(channelId)
    .collection(COLLECTIONS.videos)
    .listDocuments();
  const stale = existing.filter((ref) => !published.has(ref.id));

  // A write sets `data`, or deletes the document when there is none.
  const writes: Array<{ ref: ReturnType<typeof db.doc>; data?: object }> = [
    ...documents.videos.map((video) => ({ ref: db.doc(paths.video(video.videoId)), data: video })),
    { ref: db.doc(paths.videoIndex), data: documents.index },
    { ref: db.doc(paths.summary), data: documents.summary },
    ...stale.map((ref) => ({ ref })),
  ];
  for (let start = 0; start < writes.length; start += BATCH_WRITES) {
    const batch = db.batch();
    for (const { ref, data } of writes.slice(start, start + BATCH_WRITES)) {
      if (data) batch.set(ref, data);
      else batch.delete(ref);
    }
    await batch.commit();
  }
  return stale.length;
}

export async function publishChannel({
  channelId,
  runId = randomUUID().replaceAll("-", ""),
  now = new Date(),
  log = rootLogger,
  draws = 200,
  seed = 1,
  force = false,
  progress,
}: {
  channelId: string;
  runId?: string;
  now?: Date;
  log?: Logger;
  draws?: number;
  seed?: number;
  force?: boolean;
  /** Told how many batches of captions are written, the slow part of publishing. */
  progress?: (done: number, total: number) => void;
}): Promise<PublishResult> {
  const publishLog = childLogger(
    { channel_id: channelId, stage: PUBLISH_STEP, run_id: runId },
    log,
  );
  const inputs = await readPublishInputs(channelId);

  let traits: TraitsResult | null = null;
  if (inputs.models.size > 0) {
    try {
      traits = computeTraits(channelId, [...inputs.models.values()], inputs.features, {
        draws,
        seed,
      });
    } catch (error) {
      publishLog.warn({ err: (error as Error).message }, "no traits: published without them");
    }
  }

  const draft = assemble(inputs, traits, {
    channelId,
    runId,
    generatedAt: now.toISOString(),
    draws,
    seed,
  });
  const limit = pLimit(NARRATION_CONCURRENCY);
  let done = 0;
  progress?.(0, draft.batches.length);
  const narrated = await Promise.all(
    draft.batches.map((batch) =>
      limit(async () => {
        const narration = await narrate(channelId, batch, { log: publishLog });
        progress?.((done += 1), draft.batches.length);
        return narration;
      }),
    ),
  );
  const narrations = new Map<string, Narration>(narrated.flatMap((batch) => [...batch]));
  const documents = finalize(draft, narrations);

  const result = {
    channelId,
    runId,
    videos: documents.videos.length,
    drops: documents.videos.reduce((sum, video) => sum + video.drops.length, 0),
    templated: [...narrations.values()].filter((n) => n.source === "template").length,
    notUsable: documents.summary.audiences.some((card) => card.model && !card.model.usable),
  };
  const key = {
    asOf: asOfDate(inputs, now),
    version: PUBLISH_VERSION,
    inputs: documentsFingerprint(documents),
  };
  if (!force && (await isStepDone(channelId, PUBLISH_STEP, key))) {
    publishLog.info(result, "documents unchanged; nothing written");
    return { ...result, written: false, deleted: 0 };
  }
  const deleted = await writeDocuments(channelId, documents);
  await markStepDone(channelId, PUBLISH_STEP, {
    ...key,
    rows: { videos: documents.videos.length, deleted },
  });
  publishLog.info({ ...result, deleted }, "published");
  return { ...result, written: true, deleted };
}
