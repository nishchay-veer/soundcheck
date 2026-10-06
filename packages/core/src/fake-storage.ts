/** In-memory stand-in for the Cloud Storage calls core makes, for unit tests. */
import type { Storage } from "@google-cloud/storage";

export class FakeStorage {
  /** Object names per bucket. */
  constructor(readonly buckets: Record<string, Set<string>>) {}

  bucket(name: string) {
    const objects = (this.buckets[name] ??= new Set());
    return {
      getFiles: async ({ prefix = "" }: { prefix?: string } = {}) =>
        [
          [...objects]
            .filter((object) => object.startsWith(prefix))
            .map((object) => ({
              name: object,
              delete: async () => {
                objects.delete(object);
              },
            })),
        ] as const,
    };
  }

  asStorage(): Storage {
    return this as unknown as Storage;
  }
}
