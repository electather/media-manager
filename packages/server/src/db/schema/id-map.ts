import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

const mediaTypeEnum = ["movie", "tv"] as const;

export const idMap = sqliteTable("id_map", {
  tmdbId: text("tmdb_id").primaryKey(),
  mediaType: text("media_type", { enum: mediaTypeEnum }).notNull(),
  imdbId: text("imdb_id"),
  tvdbId: integer("tvdb_id"),
  traktId: integer("trakt_id"),
  traktSlug: text("trakt_slug"),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const insertIdMapSchema = createInsertSchema(idMap);
export const selectIdMapSchema = createSelectSchema(idMap);
