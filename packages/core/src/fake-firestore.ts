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

  /** A document by its full path, e.g. "channels/UC…/summary/current". */
  doc(path: string): FakeDocRef {
    return new FakeDocRef(this, path);
  }

  /** Runs `fn`, then applies its queued writes, as a committed transaction would. */
  async runTransaction<T>(fn: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const tx = new FakeTransaction();
    const result = await fn(tx);
    for (const write of tx.writes) await write();
    return result;
  }

  /** Sizes of the write batches committed so far, in order. */
  readonly commits: number[] = [];

  /** A write batch: its writes apply together on commit; Firestore allows at most 500. */
  batch(): FakeWriteBatch {
    return new FakeWriteBatch(this);
  }

  /** Deletes the document and everything under it (subcollections included). */
  async recursiveDelete(ref: FakeDocRef): Promise<void> {
    for (const path of [...this.docs.keys()]) {
      if (path === ref.path || path.startsWith(`${ref.path}/`)) this.docs.delete(path);
    }
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

  /** The documents directly in this collection (not in its subcollections). */
  async listDocuments(): Promise<FakeDocRef[]> {
    const prefix = `${this.path}/`;
    return [...this.db.docs.keys()]
      .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes("/"))
      .map((path) => new FakeDocRef(this.db, path));
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

  /** Like Firestore, a dotted key (`"build.progress"`) sets one nested field. */
  async update(data: Data): Promise<void> {
    const existing = this.db.docs.get(this.path);
    if (existing === undefined) throw new Error(`5 NOT_FOUND: No document to update: ${this.path}`);
    const next = structuredClone(existing);
    for (const [key, value] of Object.entries(data)) {
      const parts = key.split(".");
      const field = parts.pop() as string;
      let target = next;
      for (const part of parts) {
        const child = target[part];
        target = target[part] =
          typeof child === "object" && child !== null && !(child instanceof Date)
            ? (child as Data)
            : {};
      }
      target[field] = structuredClone(value);
    }
    this.db.docs.set(this.path, next);
  }

  async delete(): Promise<void> {
    this.db.docs.delete(this.path);
  }
}

export class FakeTransaction {
  readonly writes: Array<() => Promise<void>> = [];

  get(ref: FakeDocRef) {
    return ref.get();
  }

  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }): this {
    this.writes.push(() => ref.set(data, options));
    return this;
  }

  update(ref: FakeDocRef, data: Data): this {
    this.writes.push(() => ref.update(data));
    return this;
  }
}

export class FakeWriteBatch {
  private readonly writes: Array<() => Promise<void>> = [];

  constructor(private readonly db: FakeFirestore) {}

  set(ref: FakeDocRef, data: Data, options?: { merge?: boolean }): this {
    this.writes.push(() => ref.set(data, options));
    return this;
  }

  delete(ref: FakeDocRef): this {
    this.writes.push(() => ref.delete());
    return this;
  }

  async commit(): Promise<void> {
    if (this.writes.length > 500) {
      throw new Error(
        `3 INVALID_ARGUMENT: maximum 500 writes allowed per request, got ${this.writes.length}`,
      );
    }
    for (const write of this.writes) await write();
    this.db.commits.push(this.writes.length);
  }
}
