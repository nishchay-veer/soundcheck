/**
 * In-memory stand-in for the slice of the Firestore API that core uses, for
 * unit tests (which cannot reach the network). Install it with
 * `setClientOverride("firestore", fake.asFirestore())`.
 */
import type { Firestore } from "@google-cloud/firestore";

type Data = Record<string, unknown>;

export class FakeFirestore {
  /** Every stored document, keyed by its full path, e.g. "channels/UC…". */
  readonly docs = new Map<string, Data>();

  collection(path: string): FakeCollection {
    return new FakeCollection(this, path);
  }

  asFirestore(): Firestore {
    return this as unknown as Firestore;
  }
}

export class FakeCollection {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  doc(id: string): FakeDocRef {
    return new FakeDocRef(this.db, `${this.path}/${id}`);
  }
}

export class FakeDocRef {
  constructor(
    private readonly db: FakeFirestore,
    readonly path: string,
  ) {}

  get id(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }

  collection(name: string): FakeCollection {
    return new FakeCollection(this.db, `${this.path}/${name}`);
  }

  async get() {
    const stored = this.db.docs.get(this.path);
    return {
      id: this.id,
      exists: stored !== undefined,
      data: () => (stored === undefined ? undefined : structuredClone(stored)),
    };
  }

  async set(data: Data, options?: { merge?: boolean }): Promise<void> {
    const base = options?.merge ? (this.db.docs.get(this.path) ?? {}) : {};
    this.db.docs.set(this.path, { ...base, ...structuredClone(data) });
  }

  async update(data: Data): Promise<void> {
    const existing = this.db.docs.get(this.path);
    if (existing === undefined) throw new Error(`5 NOT_FOUND: No document to update: ${this.path}`);
    this.db.docs.set(this.path, { ...existing, ...structuredClone(data) });
  }

  async delete(): Promise<void> {
    this.db.docs.delete(this.path);
  }
}
