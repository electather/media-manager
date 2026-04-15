import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

const mediaTypeEnum = ["movie", "tv"] as const;
const actionEnum = ["like", "dislike", "rate", "note"] as const;

export const feedback = sqliteTable(
  "feedback",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    tmdbId: text("tmdb_id").notNull(),
    mediaType: text("media_type", { enum: mediaTypeEnum }).notNull(),
    action: text("action", { enum: actionEnum }).notNull(),
    rating: integer("rating"),
    note: text("note"),
    extractedSignals: text("extracted_signals"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("feedback_user_tmdb_idx").on(table.userId, table.tmdbId),
    index("feedback_user_created_at_idx").on(table.userId, table.createdAt),
  ],
);

export const insertFeedbackSchema = createInsertSchema(feedback);
export const selectFeedbackSchema = createSelectSchema(feedback);
