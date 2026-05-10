import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { ERROR_SEVERITIES, ERROR_SOURCES, PERF_KINDS } from "@ent-mcp/shared/diagnostics";
import { user } from "./auth";
import { plugins } from "./plugins";
import { serviceConnections } from "./credentials";

/** Persistent store of captured errors surfaced by the admin viewer at /admin/diagnostics.
 *  SQL table name kept as `error_records` deliberately — only the Drizzle module path
 *  was renamed to align with the diagnostics service. */
export const errorRecords = sqliteTable(
  "error_records",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    severity: text("severity", { enum: ERROR_SEVERITIES }).notNull(),
    source: text("source", { enum: ERROR_SOURCES }).notNull(),
    code: text("code"),
    devMessage: text("dev_message").notNull(),
    stack: text("stack"),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    pluginId: text("plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    connectionId: text("connection_id").references(() => serviceConnections.id, {
      onDelete: "set null",
    }),
    route: text("route"),
    httpStatus: integer("http_status"),
    context: text("context"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("error_records_created_idx").on(table.createdAt),
    index("error_records_request_id_idx").on(table.requestId),
    index("error_records_plugin_created_idx").on(table.pluginId, table.createdAt),
    index("error_records_severity_created_idx").on(table.severity, table.createdAt),
  ],
);

/** HTTP request and plugin invoke timing rows. Surfaced by the admin Performance tab. */
export const perfRecords = sqliteTable(
  "perf_records",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    kind: text("kind", { enum: PERF_KINDS }).notNull(),
    durationMs: integer("duration_ms").notNull(),
    route: text("route"),
    method: text("method"),
    status: integer("status"),
    pluginId: text("plugin_id").references(() => plugins.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("perf_records_created_idx").on(table.createdAt),
    index("perf_records_kind_route_created_idx").on(table.kind, table.route, table.createdAt),
    index("perf_records_kind_plugin_created_idx").on(table.kind, table.pluginId, table.createdAt),
    index("perf_records_request_id_idx").on(table.requestId),
  ],
);

/** Global, single-row app configuration. Houses retention settings for diagnostics
 *  and notifications. Perf retention default of 7d is shorter than errors (30d) because
 *  the row volume is meaningfully higher. */
export const appConfig = sqliteTable("app_config", {
  id: text("id").primaryKey(),
  errorRetentionDays: integer("error_retention_days").notNull().default(30),
  perfRetentionDays: integer("perf_retention_days").notNull().default(7),
  inboxRetentionDays: integer("inbox_retention_days").notNull().default(90),
  deliveryRetentionDays: integer("delivery_retention_days").notNull().default(30),
  updatedAt: integer("updated_at").notNull(),
});

export const insertErrorRecordSchema = createInsertSchema(errorRecords);
export const selectErrorRecordSchema = createSelectSchema(errorRecords);
export const insertPerfRecordSchema = createInsertSchema(perfRecords);
export const selectPerfRecordSchema = createSelectSchema(perfRecords);
export const insertAppConfigSchema = createInsertSchema(appConfig);
export const selectAppConfigSchema = createSelectSchema(appConfig);
