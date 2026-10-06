import { z } from "zod";

/** Firestore collection names. */
export const COLLECTIONS = {
  users: "users",
  channels: "channels",
  /** Under `channels/{channelId}`: one marker per finished pipeline step. */
  steps: "steps",
} as const;

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
