import type { Logger } from "pino";
import { getFirestore } from "../gcp";
import { logger as rootLogger } from "../logger";
import { COLLECTIONS, buildProgressSchema } from "../schemas";

/** At most one progress write per channel every five seconds. */
export const PROGRESS_INTERVAL_MS = 5_000;

export interface ProgressWriter {
  /**
   * Records progress. Written at once if the last write is older than the
   * interval; otherwise the latest value is written when the interval ends.
   */
  update(done: number, total: number): void;
  /** Writes any pending value now and waits for every write to finish. */
  flush(): Promise<void>;
}

/**
 * Writes `channels/{channelId}.build.progress` as `{stage, done, total,
 * updatedAt}`, throttled. Progress is best effort: a failed write is logged and
 * never fails the job.
 */
export function progressWriter(
  channelId: string,
  stage: string,
  {
    intervalMs = PROGRESS_INTERVAL_MS,
    log = rootLogger,
  }: { intervalMs?: number; log?: Logger } = {},
): ProgressWriter {
  const ref = getFirestore().collection(COLLECTIONS.channels).doc(channelId);
  let pending: { done: number; total: number } | undefined;
  let lastWriteAt = Number.NEGATIVE_INFINITY;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writes = Promise.resolve();

  const write = () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending) return;
    const progress = buildProgressSchema.parse({ stage, ...pending, updatedAt: new Date() });
    pending = undefined;
    lastWriteAt = Date.now();
    writes = writes
      .then(async () => {
        await ref.update({ "build.progress": progress });
      })
      .catch((error: unknown) => {
        log.warn({ err: error, channel_id: channelId, stage }, "build progress write failed");
      });
  };

  return {
    update(done, total) {
      pending = { done, total };
      const wait = lastWriteAt + intervalMs - Date.now();
      if (wait <= 0) write();
      else timer ??= setTimeout(write, wait);
    },
    async flush() {
      write();
      await writes;
    },
  };
}
