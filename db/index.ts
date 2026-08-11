import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

export function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error("TURSO_DATABASE_URL is not set. Use a libsql:// URL in production or file:.data/local.db for local development.");
  }
  return drizzle(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, intMode: "number" }), { schema });
}
