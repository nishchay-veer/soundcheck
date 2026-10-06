/** In-memory stand-in for the Cloud Storage calls core makes, for unit tests. */
import type { Storage } from "@google-cloud/storage";

interface SaveOptions {
  contentType?: string;
  metadata?: { metadata?: Record<string, string> };
}

export class FakeStorage {
  /** Contents of objects written through `file().save()`, keyed by `bucket/name`. */
  readonly contents = new Map<string, string>();
  /** Save options (content type, custom metadata), keyed by `bucket/name`. */
  readonly saveOptions = new Map<string, SaveOptions>();

  /** Object names per bucket. */
  constructor(readonly buckets: Record<string, Set<string>> = {}) {}

  bucket(name: string) {
    const objects = (this.buckets[name] ??= new Set());
    const remove = (object: string) => {
      objects.delete(object);
      this.contents.delete(`${name}/${object}`);
      this.saveOptions.delete(`${name}/${object}`);
    };
    return {
      name,
      getFiles: async ({ prefix = "" }: { prefix?: string } = {}) =>
        [
          [...objects]
            .filter((object) => object.startsWith(prefix))
            .map((object) => ({
              name: object,
              delete: async () => {
                remove(object);
              },
            })),
        ] as const,
      file: (object: string) => ({
        name: object,
        bucket: { name },
        save: async (data: string, options: SaveOptions = {}) => {
          objects.add(object);
          this.contents.set(`${name}/${object}`, data);
          this.saveOptions.set(`${name}/${object}`, options);
        },
        download: async () => {
          const data = this.contents.get(`${name}/${object}`);
          if (data === undefined) {
            throw Object.assign(new Error(`No such object: ${name}/${object}`), { code: 404 });
          }
          return [Buffer.from(data)] as const;
        },
        delete: async ({ ignoreNotFound = false }: { ignoreNotFound?: boolean } = {}) => {
          if (!objects.has(object) && !ignoreNotFound) {
            throw Object.assign(new Error(`No such object: ${name}/${object}`), { code: 404 });
          }
          remove(object);
        },
      }),
    };
  }

  /** The text of an object written through the fake, by `gs://` URI. */
  read(uri: string): string | undefined {
    return this.contents.get(uri.replace(/^gs:\/\//, ""));
  }

  asStorage(): Storage {
    return this as unknown as Storage;
  }
}
