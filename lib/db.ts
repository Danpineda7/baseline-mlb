import { createClient, type Client, type InValue, type ResultSet } from "@libsql/client";

// D1-compatible adapter over Turso/libSQL. The whole codebase was written
// against Cloudflare D1's statement shape (prepare().bind().run/first/all plus
// batch()), so this adapter preserves that surface exactly: every query keeps
// its SQLite dialect (json_extract, ifnull, INSERT OR IGNORE, partial indexes)
// which libSQL executes natively.

export type D1Statement = {
  sql: string;
  args: InValue[];
  bind: (...args: unknown[]) => D1Statement;
  run: () => Promise<{ meta: { changes: number } }>;
  first: <T = unknown>() => Promise<T | null>;
  all: <T = unknown>() => Promise<{ results: T[] }>;
};

export type Database = {
  prepare: (sql: string) => D1Statement;
  batch: (statements: D1Statement[]) => Promise<unknown>;
};

let client: Client | null = null;

function getClient(): Client {
  if (!client) {
    const url = process.env.TURSO_DATABASE_URL;
    if (!url) throw new Error("TURSO_DATABASE_URL is not set. Use a libsql:// URL in production or file:.data/local.db for local development.");
    client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, intMode: "number" });
  }
  return client;
}

// libSQL rows expose columns by name AND index; convert to plain named-key
// objects so JSON responses and object spreads stay clean.
function plainRows(result: ResultSet): Record<string, unknown>[] {
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])));
}

const cleanArgs = (args: unknown[]) => args.map((value) => (value === undefined ? null : value)) as InValue[];

function statement(sql: string, args: InValue[]): D1Statement {
  return {
    sql,
    args,
    bind: (...bound: unknown[]) => statement(sql, cleanArgs(bound)),
    run: async () => {
      const result = await getClient().execute({ sql, args });
      return { meta: { changes: result.rowsAffected } };
    },
    first: async <T = unknown>() => {
      const result = await getClient().execute({ sql, args });
      return (plainRows(result)[0] as T | undefined) ?? null;
    },
    all: async <T = unknown>() => {
      const result = await getClient().execute({ sql, args });
      return { results: plainRows(result) as T[] };
    },
  };
}

export function getDatabase(): Database {
  return {
    prepare: (sql: string) => statement(sql, []),
    batch: async (statements: D1Statement[]) => {
      if (!statements.length) return [];
      return getClient().batch(statements.map((entry) => ({ sql: entry.sql, args: entry.args })), "write");
    },
  };
}
