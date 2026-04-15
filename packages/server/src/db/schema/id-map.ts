import { pgTable, text, timestamp, integer } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText, integer as sqliteInteger } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

const mediaTypeEnum = ["movie", "tv"] as const;

export const idMapPg = pgTable("id_map", {
  tmdbId: text("tmdb_id").primaryKey(),
  mediaType: text("media_type", { enum: mediaTypeEnum }).notNull(),
  imdbId: text("imdb_id"),
  tvdbId: integer("tvdb_id"),
  traktId: integer("trakt_id"),
  traktSlug: text("trakt_slug"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const idMapSqlite = sqliteTable("id_map", {
  tmdbId: sqliteText("tmdb_id").primaryKey(),
  mediaType: sqliteText("media_type", { enum: mediaTypeEnum }).notNull(),
  imdbId: sqliteText("imdb_id"),
  tvdbId: sqliteInteger("tvdb_id"),
  traktId: sqliteInteger("trakt_id"),
  traktSlug: sqliteText("trakt_slug"),
  updatedAt: sqliteInteger("updated_at", { mode: "timestamp" }).notNull(),
});

export const insertIdMapPgSchema = createInsertSchema(idMapPg);
export const selectIdMapPgSchema = createSelectSchema(idMapPg);
