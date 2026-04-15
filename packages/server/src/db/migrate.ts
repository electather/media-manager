import { migrate } from "drizzle-orm/libsql/migrator";
import { consola } from "consola";
import { getDb } from "./client";

/** Runs Drizzle migrations against the SQLite database. */
export async function runMigrations(): Promise<void> {
  consola.info("Running database migrations...");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  consola.success("Database migrations complete.");
}
