import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

export const preferences = sqliteTable("preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull().unique(),
  genreScores: blob("genre_scores", { mode: "json" }).notNull(),
  themeScores: blob("theme_scores", { mode: "json" }).notNull(),
  keywordScores: blob("keyword_scores", { mode: "json" }).notNull(),
  directorScores: blob("director_scores", { mode: "json" }).notNull(),
  actorScores: blob("actor_scores", { mode: "json" }).notNull(),
  lastComputedAt: integer("last_computed_at", { mode: "timestamp" }).notNull(),
});

export const insertPreferencesSchema = createInsertSchema(preferences);
export const selectPreferencesSchema = createSelectSchema(preferences);
