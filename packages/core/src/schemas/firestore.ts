import { z } from "zod";

/** Firestore collection names. */
export const COLLECTIONS = {
  users: "users",
  channels: "channels",
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
