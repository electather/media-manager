import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

const mediaTypeEnum = ["movie", "tv"] as const;
const actionEnum = ["like", "dislike", "rate", "note"] as const;
const sentimentEnum = ["positive", "negative", "neutral"] as const;

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
    noteSentiment: text("note_sentiment", { enum: sentimentEnum }),
    noteKeywords: text("note_keywords"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("feedback_user_created_at_idx").on(table.userId, table.createdAt),
    index("feedback_user_item_idx").on(table.userId, table.tmdbId, table.mediaType),
  ],
);

export const insertFeedbackSchema = createInsertSchema(feedback);
export const selectFeedbackSchema = createSelectSchema(feedback);
