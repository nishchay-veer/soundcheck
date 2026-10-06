import { z } from "zod";
import { firestoreDate } from "./firestore";

/** `users/{userId}`. The document ID is the Google account's `sub`. */
export const userDocSchema = z.object({
  email: z.email(),
  channelIds: z.array(z.string()),
  createdAt: firestoreDate,
  lastSignInAt: firestoreDate,
});
export type UserDoc = z.infer<typeof userDocSchema>;
