import { getFirestore } from "../gcp";
import { COLLECTIONS, channelIdSchema, stepMarkerSchema, type StepMarker } from "../schemas";

/** What makes two runs of a step the same work (CLAUDE.md rule 7). */
export interface StepKey {
  /** The data date the step covers, `YYYY-MM-DD`. */
  asOf: string;
  /** The code version that produced it, from `versions.ts`. */
  version: string;
  /** A fingerprint of the inputs; when given, it must match too. */
  inputs?: string;
}

function stepRef(channelId: string, step: string) {
  channelIdSchema.parse(channelId);
  if (!/^[\w-]+$/.test(step)) throw new RangeError(`Invalid step name: ${step}`);
  return getFirestore()
    .collection(COLLECTIONS.channels)
    .doc(channelId)
    .collection(COLLECTIONS.steps)
    .doc(step);
}

/** The last finished run of `step` for this channel, or null if it never finished. */
export async function readStepMarker(channelId: string, step: string): Promise<StepMarker | null> {
  const snapshot = await stepRef(channelId, step).get();
  const marker = stepMarkerSchema.safeParse(snapshot.data());
  return marker.success ? marker.data : null;
}

/** True when `step` already finished for this channel with the same data date, version and inputs. */
export async function isStepDone(channelId: string, step: string, key: StepKey): Promise<boolean> {
  const marker = await readStepMarker(channelId, step);
  return (
    marker !== null &&
    marker.asOf === key.asOf &&
    marker.version === key.version &&
    (key.inputs === undefined || marker.inputs === key.inputs)
  );
}

/**
 * Records that `step` finished, at `channels/{channelId}/steps/{step}`, with
 * the row count written to each table. Under the channel document, so a
 * channel deletion removes it.
 */
export async function markStepDone(
  channelId: string,
  step: string,
  { asOf, version, inputs, rows }: StepKey & { rows: Record<string, number> },
): Promise<StepMarker> {
  const marker = stepMarkerSchema.parse({
    asOf,
    version,
    ...(inputs === undefined ? {} : { inputs }),
    rows,
    finishedAt: new Date(),
  });
  await stepRef(channelId, step).set(marker);
  return marker;
}
