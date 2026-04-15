import { sqliteTable, text, integer, uniqueIndex } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

const serviceEnum = ["trakt", "tmdb", "seerr", "tvdb"] as const;
const statusEnum = ["connected", "expired", "error", "disconnected"] as const;

export const serviceConnections = sqliteTable(
  "service_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    service: text("service", { enum: serviceEnum }).notNull(),
    status: text("status", { enum: statusEnum }).notNull(),
    displayName: text("display_name"),
    encryptedConfig: text("encrypted_config").notNull(),
    configIv: text("config_iv").notNull(),
    tokenExpiresAt: integer("token_expires_at"),
    lastVerifiedAt: integer("last_verified_at"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("service_connections_user_service_unique").on(table.userId, table.service),
  ],
);

export const insertServiceConnectionSchema = createInsertSchema(serviceConnections);
export const selectServiceConnectionSchema = createSelectSchema(serviceConnections);
