import { z } from "zod";

/** Firestore collection names. */
export const COLLECTIONS = {
  users: "users",
  channels: "channels",
  /** Under `channels/{channelId}`: one marker per finished pipeline step. */
  steps: "steps",
  /** Under `channels/{channelId}`: the serving documents (Phase 11). */
  summary: "summary",
  index: "index",
  videos: "videos",
  /** Under `channels/{channelId}`: new cuts (Phases 14 and 15), so disconnecting deletes them. */
  soundchecks: "soundchecks",
  /** One verdict per extraction version, apart from every channel (`extractionGateDocSchema`). */
  extractionGates: "extractionGates",
} as const;

/**
 * Where the serving documents live, as paths relative to the database:
 * the overview at `summary/current`, the video list at `index/videos`, and one
 * document per video.
 */
export const servingPaths = (channelId: string) => {
  const channel = `${COLLECTIONS.channels}/${channelId}`;
  return {
    summary: `${channel}/${COLLECTIONS.summary}/current`,
    videoIndex: `${channel}/${COLLECTIONS.index}/videos`,
    videos: `${channel}/${COLLECTIONS.videos}`,
    video: (videoId: string) => `${channel}/${COLLECTIONS.videos}/${videoId}`,
  };
};

/**
 * Where a channel's soundchecks live: each one's document, and beneath it the
 * cut as the model reads it (`inputs/current`), which the edit simulator reads.
 */
export const soundcheckPaths = (channelId: string) => {
  const soundchecks = `${COLLECTIONS.channels}/${channelId}/${COLLECTIONS.soundchecks}`;
  return {
    soundchecks,
    soundcheck: (soundcheckId: string) => `${soundchecks}/${soundcheckId}`,
    inputs: (soundcheckId: string) => `${soundchecks}/${soundcheckId}/inputs/current`,
  };
};

/**
 * A date stored in Firestore. Writes accept a Date; reads return a Firestore
 * Timestamp, which is normalized to a Date (duck-typed so this module never
 * imports the Firestore SDK).
 */
export const firestoreDate = z.preprocess(
  (value) =>
    typeof (value as { toDate?: unknown } | null)?.toDate === "function"
      ? (value as { toDate: () => Date }).toDate()
      : value,
  z.date(),
);

/**
 * `extractionGates/{extractionVersion}`: whether an extraction version passed
 * its quality gate (Phase 06), and the report that decided it. It holds no
 * channel's data, so deleting the channel the gate ran on never removes it;
 * the full report stays in `quality_reports` under that channel.
 */
export const extractionGateDocSchema = z.object({
  extractionVersion: z.string().min(1),
  passed: z.boolean(),
  /** The `quality_reports` row that decided it. */
  reportId: z.string().min(1),
  decidedAt: firestoreDate,
});
export type ExtractionGateDoc = z.infer<typeof extractionGateDocSchema>;
