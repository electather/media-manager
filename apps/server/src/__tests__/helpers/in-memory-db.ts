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

/**
 * Returns a fresh SQLite database (backed by a temp file, not `:memory:`)
 * with all migrations applied. We use a real file because libsql's
 * `:memory:` is per-connection — drizzle's `db.transaction()` opens a
 * separate connection for the BEGIN/COMMIT, which gets a brand-new empty
 * DB and breaks any test that uses transactions.
 *
 * The file lives in a fresh temp dir per call. Vitest's process exit
 * tears the dir down via {@link cleanupInMemoryDbs}, registered as an
 * `afterAll` in test files that need it.
 */
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

/**
 * Like {@link createInMemoryDb} but mirrors the *production* connection setup:
 * only the `PRAGMA journal_mode=WAL` + `busy_timeout` that `initDb` applies, and
 * crucially NO explicit `PRAGMA foreign_keys`. Use this to assert that libSQL
 * enforces foreign keys by its per-connection default — the production path never
 * enables them, and {@link createInMemoryDb}'s explicit `foreign_keys = ON` would
 * otherwise mask a regression (an FK test on it proves nothing about prod). See
 * #852 M1.
 */
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
