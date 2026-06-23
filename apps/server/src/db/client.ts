import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";
import * as schema from "./schema/index";

export type Db = ReturnType<typeof drizzle>;

let instance: Db | undefined;

function resolveDbUrl(): string {
  return env.SQLITE_PATH ?? "file:./data/nama.db";
}

/** Returns a singleton Drizzle instance backed by a local libSQL/SQLite file. */
export function getDb(): Db {
  if (instance) return instance;

  const url = resolveDbUrl();
  // Ensure the parent directory for the local SQLite file exists.
  mkdirSync(dirname(url.replace(/^file:/, "")), { recursive: true });
  instance = drizzle(createClient({ url }), { schema });

  return instance;
}

/**
 * Call once at startup before runMigrations. Sets WAL (concurrent reads during writes)
 * and busy_timeout=5000. Foreign keys not set: libSQL enables per-connection by default; regression locked in #852.
 */
export async function initDb(): Promise<void> {
  const db = getDb();
  await db.run(sql`PRAGMA journal_mode=WAL`);
  await db.run(sql`PRAGMA busy_timeout=5000`);
}
