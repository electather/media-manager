import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../env";
import * as schema from "./schema/index";

export type Db = ReturnType<typeof drizzle>;

let instance: Db | undefined;

/** Returns a singleton Drizzle instance backed by libSQL/SQLite. */
export function getDb(): Db {
  if (instance) return instance;

  const url = env.SQLITE_PATH ?? "file:./data/ent-mcp.db";
  // Ensure the parent directory exists before libSQL tries to open the file.
  mkdirSync(dirname(url.replace(/^file:/, "")), { recursive: true });
  instance = drizzle(createClient({ url }), { schema });

  return instance;
}
