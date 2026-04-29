import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";
import * as schema from "./schema/index";

export type Db = ReturnType<typeof drizzle>;

let instance: Db | undefined;

const isRemoteUrl = (url: string) => /^(libsql|wss?|https?):/.test(url);

function resolveDbUrl(): string {
  return env.SQLITE_PATH ?? "file:./data/ent-mcp.db";
}

/** Returns a singleton Drizzle instance backed by libSQL/SQLite. */
export function getDb(): Db {
  if (instance) return instance;

  const url = resolveDbUrl();
  // Only create the parent directory when the URL points at a local SQLite
  // file. Hosted libSQL (Turso) URLs use http/https/libsql/ws schemes and
  // have no local path.
  if (!isRemoteUrl(url)) {
    mkdirSync(dirname(url.replace(/^file:/, "")), { recursive: true });
  }
  instance = drizzle(createClient({ url, authToken: env.LIBSQL_AUTH_TOKEN }), { schema });

  return instance;
}

/**
 * Applies one-time SQLite connection settings for local files. Must be called
 * once at startup before runMigrations. WAL mode allows concurrent reads
 * during writes; busy_timeout retries on lock contention instead of failing
 * immediately with SQLITE_BUSY.
 */
export async function initDb(): Promise<void> {
  if (isRemoteUrl(resolveDbUrl())) return;
  const db = getDb();
  await db.run(sql`PRAGMA journal_mode=WAL`);
  await db.run(sql`PRAGMA busy_timeout=5000`);
}
