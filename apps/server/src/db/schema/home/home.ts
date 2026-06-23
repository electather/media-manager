import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "../auth/auth";

/**
 * Per-user pre-rendered blob; fresh row short-circuits composition, stale/missing falls
 * through to orchestrator. `schema_version` checked against `CURRENT_SCHEMA_VERSION` (home/layout-cache.ts);
 * bump it to drain stale blobs. `generated_at` (ms epoch) vs 60-minute TTL; `host.home.layout_warm` rewrites.
 */
export const homeLayoutCache = sqliteTable(
  "home_layout_cache",
  {
    userId: text("user_id")
      .primaryKey()
      .references(() => user.id, { onDelete: "cascade" }),
    schemaVersion: integer("schema_version").notNull(),
    blob: text("blob").notNull(),
    generatedAt: integer("generated_at").notNull(),
  },
  (table) => [index("home_layout_cache_generated_at_idx").on(table.generatedAt)],
);
