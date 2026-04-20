import { sqliteTable, text, integer, blob, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

const profileMediaTypeEnum = ["movie", "tv", "combined"] as const;
const confidenceEnum = ["low", "medium", "high"] as const;

export const preferenceProfiles = sqliteTable(
  "preference_profiles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaType: text("media_type", { enum: profileMediaTypeEnum }).notNull(),
    features: text("features").notNull(),
    sampleSize: integer("sample_size").notNull(),
    confidence: text("confidence", { enum: confidenceEnum }).notNull(),
    lastRebuiltAt: integer("last_rebuilt_at").notNull(),
    lastUpdatedAt: integer("last_updated_at").notNull(),
    embedding: blob("embedding"),
    embeddingModel: text("embedding_model"),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mediaType] })],
);

export const insertPreferenceProfileSchema = createInsertSchema(preferenceProfiles);
export const selectPreferenceProfileSchema = createSelectSchema(preferenceProfiles);
