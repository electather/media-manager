import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";
import { plugins } from "./plugins";
import { serviceConnections } from "./credentials";

const severityEnum = ["error", "warning"] as const;
const sourceEnum = ["frontend", "backend", "plugin", "cron"] as const;

/** Persistent store of captured errors surfaced by the admin viewer at /admin/errors. */
export const errorRecords = sqliteTable(
  "error_records",
  {
    id: text("id").primaryKey(),
    requestId: text("request_id").notNull(),
    severity: text("severity", { enum: severityEnum }).notNull(),
    source: text("source", { enum: sourceEnum }).notNull(),
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

/** Global, single-row app configuration. Currently houses error-retention settings. */
export const appConfig = sqliteTable("app_config", {
  id: text("id").primaryKey(),
  errorRetentionDays: integer("error_retention_days").notNull().default(30),
  updatedAt: integer("updated_at").notNull(),
});

export const insertErrorRecordSchema = createInsertSchema(errorRecords);
export const selectErrorRecordSchema = createSelectSchema(errorRecords);
export const insertAppConfigSchema = createInsertSchema(appConfig);
export const selectAppConfigSchema = createSelectSchema(appConfig);
