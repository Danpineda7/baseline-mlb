// Applies drizzle/*.sql migrations, in order, to TURSO_DATABASE_URL.
// Applied migration tags are recorded in a _migrations table, so re-running is
// always safe. Works against both a real Turso database and a local file DB:
//   TURSO_DATABASE_URL=file:.data/local.db npm run db:migrate
import { createClient } from "@libsql/client";
import { readFile, readdir, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("TURSO_DATABASE_URL is not set. Example: TURSO_DATABASE_URL=file:.data/local.db npm run db:migrate");
  process.exit(1);
}
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if (url.startsWith("file:")) await mkdir(path.resolve(root, path.dirname(url.slice(5))), { recursive: true }).catch(() => {});

const client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
await client.execute("CREATE TABLE IF NOT EXISTS _migrations (tag TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
const applied = new Set((await client.execute("SELECT tag FROM _migrations")).rows.map((row) => row[0]));

const migrationsDir = path.join(root, "drizzle");
const files = (await readdir(migrationsDir)).filter((name) => /^\d{4}_.*\.sql$/.test(name)).sort();

let appliedNow = 0;
for (const file of files) {
  const tag = file.replace(/\.sql$/, "");
  if (applied.has(tag)) continue;
  const sql = await readFile(path.join(migrationsDir, file), "utf8");
  const statements = sql.split("--> statement-breakpoint").map((statement) => statement.trim()).filter(Boolean);
  console.log(`applying ${tag} (${statements.length} statements)`);
  for (const statement of statements) await client.execute(statement);
  await client.execute({ sql: "INSERT INTO _migrations (tag, applied_at) VALUES (?, ?)", args: [tag, new Date().toISOString()] });
  appliedNow += 1;
}
console.log(appliedNow ? `done: ${appliedNow} migration(s) applied` : "up to date: no new migrations");
client.close();
