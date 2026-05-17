// @owner: home
import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

/**
 * Per-user pre-rendered `HomeLayoutResponse` blob. Read-once on every
 * `home.getLayout` call: a fresh row short-circuits the live composition,
 * and a stale or missing row falls through to the orchestrator + writeback.
 *
 * `schema_version` pins the wire shape the blob was rendered against. The
 * orchestrator discards rows whose version disagrees with `CURRENT_SCHEMA_VERSION`
 * (defined in `home/layout-cache.ts`), so adding a field to
 * `HomeLayoutResponse` / `HomeRowStub` / `LayoutHero` is safe — bump the
 * constant and the fleet drains the next time each user pings the endpoint.
 *
 * `generated_at` is a wall-clock ms epoch the freshness check uses against a
 * 60-minute TTL; the `host.home.layout_warm` job rewrites blobs older than
 * that for active users.
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
