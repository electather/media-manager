import { migrate } from "drizzle-orm/libsql/migrator";
import { consola } from "consola";
import { getDb } from "./client";
import { seedRoles, seedDevUser } from "./seed";

/** Runs Drizzle migrations against the SQLite database, then seeds default data. */
export async function runMigrations(): Promise<void> {
  consola.info("Running database migrations...");
  await migrate(getDb(), { migrationsFolder: "./drizzle" });
  consola.success("Database migrations complete.");
  await seedRoles();
  if (process.env.NODE_ENV === "development") {
    await seedDevUser();
  }
}
