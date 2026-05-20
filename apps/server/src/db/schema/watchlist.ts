// @owner: watchlist
import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MEDIA_TYPES } from "@ent-mcp/shared/media";
import { WATCHLIST_SOURCES, WATCHLIST_STATES } from "@ent-mcp/shared/watchlist";
import { user } from "./auth";

/**
 * One row per `(user_id, tmdb_id, media_type)`. `state` acts as a tombstone:
 * a user-removed row stays at `state = "removed"` so a later plugin sync does
 * not resurrect it. `added_at` is bumped on reactivation (active → removed →
 * active) so "recently added" ordering reflects the user's last action.
 */
export const watchlistItems = sqliteTable(
  "watchlist_items",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tmdbId: text("tmdb_id").notNull(),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    state: text("state", { enum: WATCHLIST_STATES }).notNull(),
    source: text("source", { enum: WATCHLIST_SOURCES }).notNull(),
    addedAt: integer("added_at").notNull(),
    removedAt: integer("removed_at"),
    seeded: integer("seeded").notNull().default(0),
  },
  (table) => [
    uniqueIndex("watchlist_items_user_tmdb_type_uq").on(
      table.userId,
      table.tmdbId,
      table.mediaType,
    ),
    index("watchlist_items_user_state_added_idx").on(table.userId, table.state, table.addedAt),
    index("watchlist_items_user_state_idx").on(table.userId, table.state),
  ],
);

/**
 * Marker rows. Presence means the user has been seeded from the plugin
 * watchlist feed at least once. Eager-seed on first GET upserts here so the
 * 6-hourly sync cron can iterate exactly the seeded users.
 */
export const userWatchlistSeed = sqliteTable("user_watchlist_seed", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seededAt: integer("seeded_at").notNull(),
});
