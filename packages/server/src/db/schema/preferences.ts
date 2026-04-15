import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

export const preferenceProfiles = sqliteTable("preference_profiles", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  genreScores: text("genre_scores").notNull(),
  themeScores: text("theme_scores").notNull(),
  keywordScores: text("keyword_scores").notNull(),
  directorScores: text("director_scores").notNull(),
  actorScores: text("actor_scores").notNull(),
  ratingStats: text("rating_stats").notNull(),
  lastComputedAt: integer("last_computed_at").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const insertPreferenceProfileSchema = createInsertSchema(preferenceProfiles);
export const selectPreferenceProfileSchema = createSelectSchema(preferenceProfiles);
