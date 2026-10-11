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
  /** Top level: new cuts (Phases 14 and 15). */
  soundchecks: "soundchecks",
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
