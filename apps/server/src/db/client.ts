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
 * Applies one-time SQLite connection settings. Must be called once at startup
 * before runMigrations. WAL mode allows concurrent reads during writes;
 * busy_timeout retries on lock contention instead of failing immediately with
 * SQLITE_BUSY.
 *
 * Foreign-key enforcement is intentionally NOT set here. libSQL enables
 * `PRAGMA foreign_keys` by default on every connection it opens — unlike the
 * vanilla SQLite C library, whose default is OFF — and `@libsql/client` opens a
 * fresh connection per transaction, so a one-shot PRAGMA on this startup handle
 * could not cover them regardless. The `invited_by … ON DELETE SET NULL` and
 * `role_id` FKs are therefore enforced in production; the `ON DELETE SET NULL`
 * regression test in `api/procedures/__tests__/invites.test.ts` locks that
 * guarantee so a future libSQL default change fails the build (#852 M1).
 */
export async function initDb(): Promise<void> {
  const db = getDb();
  await db.run(sql`PRAGMA journal_mode=WAL`);
  await db.run(sql`PRAGMA busy_timeout=5000`);
}
