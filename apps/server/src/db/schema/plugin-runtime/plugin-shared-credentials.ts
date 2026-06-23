import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { plugins } from "./plugins";

/**
 * Admin-owned encrypted credentials for a plugin. Poolable plugins rotate
 * across enabled entries with cooldown bookkeeping; non-poolable plugins allow
 * exactly one row per plugin (enforced at insert time).
 */
export const pluginSharedCredentials = sqliteTable(
  "plugin_shared_credentials",
  {
    id: text("id").primaryKey(),
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    encryptedValue: text("encrypted_value").notNull(),
    iv: text("iv").notNull(),
    enabled: integer("enabled").notNull().default(1),
    lastExhaustedAt: integer("last_exhausted_at"),
    retryAfter: integer("retry_after"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [index("psc_plugin_enabled_idx").on(table.pluginId, table.enabled)],
);

export const insertPluginSharedCredentialSchema = createInsertSchema(pluginSharedCredentials);
export const selectPluginSharedCredentialSchema = createSelectSchema(pluginSharedCredentials);
