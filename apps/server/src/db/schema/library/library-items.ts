import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { MEDIA_TYPES } from "@nama/shared/media";
import { WATCHED_STATES } from "@nama/shared/library";
import { user } from "../auth/auth";

/** Denormalized browse projection for owned library.
 *  PK: (user_id, id) where id="<mediaType>:<tmdbId>". `owned` is tombstone: false prevents resurrection on sync.
 *  JSON columns (servers, quality_tiers) multi-valued; lenses expand via json_each. `$type<T>()` documents serialization contract. */
export const libraryItems = sqliteTable(
  "library_items",
  {
    id: text("id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tmdbId: text("tmdb_id").notNull(),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    owned: integer("owned", { mode: "boolean" }).notNull().default(true),
    ownedAt: integer("owned_at").notNull(),
    unownedAt: integer("unowned_at"),
    sortTitle: text("sort_title").notNull().default(""),
    year: integer("year"),
    genres: text("genres", { mode: "json" }).$type<string[]>().notNull().default([]),
    servers: text("servers", { mode: "json" })
      .$type<{ id: string; label: string }[]>()
      .notNull()
      .default([]),
    qualityTiers: text("quality_tiers", { mode: "json" }).$type<string[]>().notNull().default([]),
    watchedState: text("watched_state", { enum: WATCHED_STATES }),
    collectionId: text("collection_id"),
    collectionName: text("collection_name"),
    hydratedAt: integer("hydrated_at"),
  },
  (table) => [
    // Composite primary key: `id` ("<mediaType>:<tmdbId>") is unique only within
    // a user, so the same title owned by two users is two distinct rows. A single
    // global `id` PK would collide on the second owner and the membership upsert's
    // ON CONFLICT DO NOTHING would silently drop them.
    primaryKey({ columns: [table.userId, table.id] }),
    uniqueIndex("library_items_user_tmdb_type_uq").on(table.userId, table.tmdbId, table.mediaType),
    index("library_items_user_owned_sort_id_idx").on(
      table.userId,
      table.owned,
      table.sortTitle,
      table.id,
    ),
    index("library_items_user_owned_year_id_idx").on(
      table.userId,
      table.owned,
      table.year,
      table.id,
    ),
    index("library_items_user_owned_collection_idx").on(
      table.userId,
      table.owned,
      table.collectionId,
    ),
  ],
);
