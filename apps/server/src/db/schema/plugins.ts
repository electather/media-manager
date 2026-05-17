// @owner: plugin-runtime
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { PERSONAL_KEY_FALLBACK_POLICIES, PLUGIN_SOURCE_TYPES } from "@ent-mcp/shared/plugins";
import { user } from "./auth";

/** Registry of installed plugins. One row per plugin id. */
export const plugins = sqliteTable("plugins", {
  id: text("id").primaryKey(),
  version: text("version").notNull(),
  sourceUrl: text("source_url").notNull(),
  sourceType: text("source_type", { enum: PLUGIN_SOURCE_TYPES }).notNull(),
  checksum: text("checksum").notNull(),
  manifest: text("manifest").notNull(),
  enabled: integer("enabled").notNull().default(1),
  globalConfig: text("global_config"),
  personalKeyFallback: text("personal_key_fallback", { enum: PERSONAL_KEY_FALLBACK_POLICIES })
    .notNull()
    .default("off"),
  /**
   * Admin-set host allowlist. `null` means "inherit manifest allowlist"
   * (no narrowing). An empty array `[]` blocks every static host — legitimate
   * for deployments that only want the user-supplied `x-allowed-host` path.
   */
  adminAllowlist: text("admin_allowlist"),
  /**
   * Encrypted admin headers blob (`Record<string, string>`). Same
   * AES-256-GCM path as `plugin_shared_credentials`. `null` when no admin
   * headers are configured.
   */
  adminHeadersEncrypted: text("admin_headers_encrypted"),
  adminHeadersIv: text("admin_headers_iv"),
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
// fallow-ignore-next-line code-duplication
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
