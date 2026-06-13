import { sqliteTable, text, integer, primaryKey, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { MEDIA_TYPES } from "@nama/shared/media";

export const idMap = sqliteTable(
  "id_map",
  {
    tmdbId: text("tmdb_id").notNull(),
    mediaType: text("media_type", { enum: MEDIA_TYPES }).notNull(),
    imdbId: text("imdb_id"),
    tvdbId: text("tvdb_id"),
    traktId: text("trakt_id"),
    traktSlug: text("trakt_slug"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.tmdbId, table.mediaType] }),
    index("id_map_imdb_idx").on(table.imdbId),
    index("id_map_tvdb_idx").on(table.tvdbId),
    index("id_map_trakt_idx").on(table.traktId),
  ],
);

export const insertIdMapSchema = createInsertSchema(idMap);
export const selectIdMapSchema = createSelectSchema(idMap);
