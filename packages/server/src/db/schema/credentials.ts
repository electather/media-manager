import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

const providerEnum = ["trakt", "tmdb", "seerr", "tvdb"] as const;

export const credentials = sqliteTable("credentials", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  provider: text("provider", { enum: providerEnum }).notNull(),
  encryptedData: text("encrypted_data").notNull(),
  expiresAt: integer("expires_at", { mode: "timestamp" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const insertCredentialSchema = createInsertSchema(credentials);
export const selectCredentialSchema = createSelectSchema(credentials);
