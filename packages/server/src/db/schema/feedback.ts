import { sqliteTable, text, integer, blob } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

const mediaTypeEnum = ["movie", "tv"] as const;
const actionEnum = ["like", "dislike", "rate", "note"] as const;

export const feedback = sqliteTable("feedback", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  tmdbId: text("tmdb_id").notNull(),
  mediaType: text("media_type", { enum: mediaTypeEnum }).notNull(),
  action: text("action", { enum: actionEnum }).notNull(),
  rating: integer("rating"),
  note: text("note"),
  extractedSignals: blob("extracted_signals", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const insertFeedbackSchema = createInsertSchema(feedback);
export const selectFeedbackSchema = createSelectSchema(feedback);
