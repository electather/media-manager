import { sqliteTable, text, integer, blob, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { CONFIDENCE_LEVELS, PROFILE_MEDIA_TYPES } from "@ent-mcp/shared/preferences";
import { user } from "./auth";

export const preferenceProfiles = sqliteTable(
  "preference_profiles",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    mediaType: text("media_type", { enum: PROFILE_MEDIA_TYPES }).notNull(),
    features: text("features").notNull(),
    sampleSize: integer("sample_size").notNull(),
    confidence: text("confidence", { enum: CONFIDENCE_LEVELS }).notNull(),
    lastRebuiltAt: integer("last_rebuilt_at").notNull(),
    lastUpdatedAt: integer("last_updated_at").notNull(),
    embedding: blob("embedding"),
    embeddingModel: text("embedding_model"),
    version: integer("version").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.userId, table.mediaType] })],
);

export const insertPreferenceProfileSchema = createInsertSchema(preferenceProfiles);
export const selectPreferenceProfileSchema = createSelectSchema(preferenceProfiles);
