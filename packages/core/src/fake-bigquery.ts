/**
 * In-memory stand-in for the BigQuery calls core makes, for unit tests: rows
 * per table, an INFORMATION_SCHEMA lookup for `channel_id` columns,
 * parameterized `DELETE … WHERE channel_id = @channelId` jobs, and the
 * staging-table load plus delete-and-insert transaction of `replaceChannelRows`.
 */
import type { BigQuery } from "@google-cloud/bigquery";
import type { FakeStorage } from "./fake-storage";

type Row = Record<string, unknown>;

interface LoadConfiguration {
  sourceUris: string[];
  sourceFormat?: string;
  destinationTable: { tableId: string };
  writeDisposition?: string;
}

const DELETE = /^DELETE FROM `[^`]+\.([^.`]+)` WHERE channel_id = @channelId;?$/;
const INSERT =
  /^INSERT INTO `[^`]+\.([^.`]+)` \(([^)]+)\) SELECT \2 FROM `[^`]+\.([^.`]+)` WHERE channel_id = @channelId;$/;

export class FakeBigQuery {
  readonly queries: Array<{ query: string; params?: Record<string, unknown>; location?: string }> =
    [];
  readonly loads: Array<{ configuration: { load: LoadConfiguration }; location?: string }> = [];
  /** Tables created through `dataset().createTable()`, with their options. */
  readonly created = new Map<string, { schema: unknown; expirationTime?: string }>();
  /** Set to make every DELETE fail, e.g. like rows still in the streaming buffer. */
  failDeletes: Error | undefined;
  /** Set to make every load job fail. */
  failLoads: Error | undefined;

  constructor(
    readonly tables: Record<string, Row[]>,
    private readonly options: {
      /** Column names per table, returned by `table().getMetadata()`. */
      columns?: Record<string, string[]>;
      /** Where load jobs read their `gs://` source files. */
      storage?: FakeStorage;
    } = {},
  ) {}

  async query(options: { query: string; location?: string }) {
    this.queries.push(options);
    if (!options.query.includes("INFORMATION_SCHEMA.COLUMNS"))
      throw new Error(`Unexpected query: ${options.query}`);
    return [
      Object.keys(this.tables)
        .sort()
        .map((table_name) => ({ table_name })),
    ] as const;
  }

  async createQueryJob(options: {
    query: string;
    params?: Record<string, unknown>;
    location?: string;
  }) {
    this.queries.push(options);
    const channelId = options.params?.channelId;
    const statements = options.query.startsWith("BEGIN TRANSACTION;")
      ? options.query.split("\n").slice(1, -1)
      : [options.query];
    if (
      options.query.startsWith("BEGIN TRANSACTION;") &&
      !options.query.endsWith("COMMIT TRANSACTION;")
    )
      throw new Error(`Unterminated transaction: ${options.query}`);

    // Apply every statement to a copy, then commit, so a failure changes nothing.
    const next = structuredClone(this.tables);
    let affected = 0;
    for (const statement of statements) {
      const deletion = DELETE.exec(statement);
      const insertion = INSERT.exec(statement);
      if (deletion?.[1]) {
        if (this.failDeletes) throw this.failDeletes;
        const rows = next[deletion[1]] ?? [];
        const kept = rows.filter((row) => row.channel_id !== channelId);
        next[deletion[1]] = kept;
        affected += rows.length - kept.length;
      } else if (insertion?.[1] && insertion[2] && insertion[3]) {
        const source = next[insertion[3]];
        if (!source) throw new Error(`Not found: Table ${insertion[3]}`);
        const columns = insertion[2].split(", ").map((column) => column.replaceAll("`", ""));
        const inserted = source
          .filter((row) => row.channel_id === channelId)
          .map((row) => Object.fromEntries(columns.map((column) => [column, row[column] ?? null])));
        next[insertion[1]] = [...(next[insertion[1]] ?? []), ...inserted];
        affected += inserted.length;
      } else {
        throw new Error(`Unexpected statement: ${statement}`);
      }
    }
    Object.assign(this.tables, next);

    const job = {
      getQueryResults: async () => [[]] as const,
      getMetadata: async () =>
        [{ statistics: { query: { numDmlAffectedRows: String(affected) } } }] as const,
    };
    return [job] as const;
  }

  async createJob(options: { configuration: { load: LoadConfiguration }; location?: string }) {
    this.loads.push(options);
    const { load } = options.configuration;
    const run = async () => {
      if (this.failLoads) throw this.failLoads;
      const table = load.destinationTable.tableId;
      const existing = this.tables[table];
      if (!existing) throw new Error(`Not found: Table ${table}`);
      if (load.writeDisposition === "WRITE_EMPTY" && existing.length > 0)
        throw new Error(`Already Exists: Table ${table} is not empty`);
      for (const uri of load.sourceUris) {
        const text = this.options.storage?.read(uri);
        if (text === undefined) throw new Error(`Not found: URI ${uri}`);
        existing.push(
          ...text
            .split("\n")
            .filter(Boolean)
            .map((line) => JSON.parse(line) as Row),
        );
      }
      return [{ status: { state: "DONE" } }] as const;
    };
    return [{ promise: run }] as const;
  }

  dataset() {
    return {
      table: (name: string) => ({
        getMetadata: async () => {
          const columns = this.options.columns?.[name];
          if (!columns) throw Object.assign(new Error(`Not found: Table ${name}`), { code: 404 });
          return [{ schema: { fields: columns.map((column) => ({ name: column })) } }] as const;
        },
        delete: async ({ ignoreNotFound = false }: { ignoreNotFound?: boolean } = {}) => {
          if (!(name in this.tables) && !ignoreNotFound)
            throw Object.assign(new Error(`Not found: Table ${name}`), { code: 404 });
          delete this.tables[name];
        },
      }),
      createTable: async (name: string, options: { schema: unknown; expirationTime?: string }) => {
        if (name in this.tables) throw new Error(`Already Exists: Table ${name}`);
        this.tables[name] = [];
        this.created.set(name, options);
        return [{}] as const;
      },
    };
  }

  asBigQuery(): BigQuery {
    return this as unknown as BigQuery;
  }
}
