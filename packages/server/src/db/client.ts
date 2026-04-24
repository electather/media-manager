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
  // Only create the parent directory when the URL points at a local SQLite
  // file. Hosted libSQL (Turso) URLs use http/https/libsql/ws schemes and
  // have no local path.
  const isRemote = /^(libsql|wss?|https?):/.test(url);
  if (!isRemote) {
    mkdirSync(dirname(url.replace(/^file:/, "")), { recursive: true });
  }
  instance = drizzle(createClient({ url, authToken: env.LIBSQL_AUTH_TOKEN }), { schema });

  return instance;
}
