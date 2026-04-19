import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

const sourceTypeEnum = ["builtin", "url"] as const;

/** Registry of installed plugins. One row per plugin id. */
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type", { enum: sourceTypeEnum }).notNull(),
  checksum: text("checksum").notNull(),
  manifest: text("manifest").notNull(),
  enabled: integer("enabled").notNull().default(1),
  globalConfig: text("global_config"),
  globalConfigIv: text("global_config_iv"),
  installedBy: text("installed_by").references(() => user.id, { onDelete: "set null" }),
  installedAt: integer("installed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Plugin-scoped KV store backing ctx.store. Namespaced by (plugin_id, user_id, key). */
export const pluginStore = sqliteTable(
  "plugin_store",
  {
    pluginId: text("plugin_id")
      .notNull()
      .references(() => plugins.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => user.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.pluginId, table.userId, table.key] }),
    index("plugin_store_expires_idx").on(table.expiresAt),
  ],
);

/** Short-lived OAuth state, keyed by nonce, with 15-minute TTL. */
export const pendingAuth = sqliteTable("pending_auth", {
  nonce: text("nonce").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  pluginId: text("plugin_id")
    .notNull()
    .references(() => plugins.id, { onDelete: "cascade" }),
  state: text("state").notNull(),
  stateIv: text("state_iv").notNull(),
  createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const insertPluginSchema = createInsertSchema(plugins);
export const selectPluginSchema = createSelectSchema(plugins);
export const insertPluginStoreSchema = createInsertSchema(pluginStore);
export const selectPluginStoreSchema = createSelectSchema(pluginStore);
export const insertPendingAuthSchema = createInsertSchema(pendingAuth);
export const selectPendingAuthSchema = createSelectSchema(pendingAuth);
