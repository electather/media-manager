import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { CONNECTION_STATUSES } from "@ent-mcp/shared/connections";
import { user } from "./auth";
import { plugins } from "./plugins";

/**
 * One row per user-plugin connection instance. Multiple rows are allowed
 * per (user, plugin); exactly one may be marked default.
 */
export const serviceConnections = sqliteTable(
  "service_connections",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    status: text("status", { enum: CONNECTION_STATUSES }).notNull(),
    enabled: integer("enabled").notNull().default(1),
    isDefault: integer("is_default").notNull().default(0),
    displayName: text("display_name"),
    userConfig: text("user_config"),
    encryptedCredentials: text("encrypted_credentials"),
    credentialsIv: text("credentials_iv"),
    tokenExpiresAt: integer("token_expires_at"),
    lastVerifiedAt: integer("last_verified_at"),
    lastExhaustedAt: integer("last_exhausted_at"),
    retryAfter: integer("retry_after"),
    errorMessage: text("error_message"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("service_connections_user_plugin_idx").on(table.userId, table.pluginId)],
);

export const insertServiceConnectionSchema = createInsertSchema(serviceConnections);
export const selectServiceConnectionSchema = createSelectSchema(serviceConnections);
