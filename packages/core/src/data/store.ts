import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fixturesMode, pickServerEnv } from "../env";
import { FixturesModeError } from "../errors";
import { getFirestore } from "../gcp";

/**
 * Where the data functions read documents: Firestore, or in fixtures mode the
 * saved copies `scripts/export-fixtures.ts` writes, one JSON file per document
 * at its Firestore path under FIXTURES_DIR (`channels/UC…/summary/current.json`).
 */

/** The signed-in user in fixtures mode, who owns the fixture channel. */
export const FIXTURE_USER_ID = "fixture-user";

/** How fixture files store a Firestore timestamp, which JSON cannot. */
const DATE_KEY = "$date";

const SEGMENT = /^[\w-]+$/;

/** A JSON-safe copy of a document: timestamps become `{ "$date": ISO }`. */
export function toFixture(value: unknown): unknown {
  if (value instanceof Date) return { [DATE_KEY]: value.toISOString() };
  if (typeof (value as { toDate?: unknown } | null)?.toDate === "function") {
    return { [DATE_KEY]: (value as { toDate: () => Date }).toDate().toISOString() };
  }
  if (Array.isArray(value)) return value.map(toFixture);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, toFixture(child)]));
  }
  return value;
}

/** Reads a fixture file's JSON, turning `{ "$date": ISO }` back into a Date. */
export function fromFixture(text: string): unknown {
  return JSON.parse(text, (_key, value: unknown) =>
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 1 &&
    typeof (value as Record<string, unknown>)[DATE_KEY] === "string"
      ? new Date((value as Record<string, string>)[DATE_KEY] as string)
      : value,
  );
}

/** The fixture file of a document path. */
export function fixturePath(path: string): string {
  const segments = path.split("/");
  if (segments.length % 2 !== 0 || !segments.every((segment) => SEGMENT.test(segment))) {
    throw new RangeError(`Not a document path: ${path}`);
  }
  return join(resolve(pickServerEnv(["FIXTURES_DIR"]).FIXTURES_DIR), ...segments) + ".json";
}

/** A document's data, or undefined when it does not exist. */
export async function readDocument(path: string): Promise<unknown> {
  if (!fixturesMode()) {
    const snapshot = await getFirestore().doc(path).get();
    return snapshot.exists ? snapshot.data() : undefined;
  }
  try {
    return fromFixture(await readFile(fixturePath(path), "utf8"));
  } catch (error) {
    if ((error as { code?: unknown }).code === "ENOENT") return undefined;
    throw error;
  }
}

/** Refuses a write in fixtures mode, which must never touch real data. */
export function refuseInFixturesMode(action: string): void {
  if (fixturesMode()) throw new FixturesModeError(action);
}
