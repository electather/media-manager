import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as schema from "../../db/schema/index";

export type Db = ReturnType<typeof drizzle<typeof schema>>;

const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../../drizzle");

const tempDirs: string[] = [];

/** Fresh SQLite database with migrations applied. Uses temp file, not `:memory:`, because drizzle's `db.transaction()` opens a separate connection which would get an empty DB (breaks transactional tests). Cleanup via {@link cleanupInMemoryDbs}. */
export async function createInMemoryDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), "nama-test-"));
  tempDirs.push(dir);
  const filePath = join(dir, "test.db");
  const client = createClient({ url: `file:${filePath}` });
  await client.execute("PRAGMA foreign_keys = ON");
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

/** Production-like setup: `PRAGMA journal_mode=WAL` + `busy_timeout`, NO explicit `foreign_keys` (tests FK enforcement defaults #852 M1). Requires `afterAll(cleanupInMemoryDbs)`. */
export async function createProductionLikeDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), "nama-test-prod-"));
  tempDirs.push(dir);
  const filePath = join(dir, "test.db");
  const client = createClient({ url: `file:${filePath}` });
  const db = drizzle(client, { schema });
  await db.run(sql`PRAGMA journal_mode=WAL`);
  await db.run(sql`PRAGMA busy_timeout=5000`);
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db;
}

export function cleanupInMemoryDbs(): void {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}
