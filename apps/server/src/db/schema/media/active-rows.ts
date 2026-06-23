import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
import { MEDIA_TYPES } from "@nama/shared/media";
import { WATCHLIST_SOURCES, WATCHLIST_STATES } from "@nama/shared/watchlist";
import { user } from "../auth/auth";

// One row per (user_id, tmdb_id, media_type). state="removed" acts as tombstone to prevent plugin sync resurrection. added_at is bumped on reactivation so "recently added" reflects user's last action.
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

// Marker rows: presence means user was seeded from plugin watchlist feed. First GET eager-seed upsert allows 6-hourly sync cron to iterate only seeded users.
export const userWatchlistSeed = sqliteTable("user_watchlist_seed", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  seededAt: integer("seeded_at").notNull(),
});
