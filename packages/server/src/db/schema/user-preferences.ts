import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";
import { serviceConnections } from "./credentials";

/**
 * Per-user primary-connection selection, used by capabilities with the
 * `primary_with_enrichment` strategy (metadata@v1). Rows are keyed by
 * `(userId, capabilityKey, mediaType)` where `capabilityKey` is "metadata@v1"
 * and `mediaType` is "movie"|"tv"|"_" (sentinel "_" when not segmented).
 */
export const primaryConnections = sqliteTable(
  "primary_connections",
  {
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    capabilityKey: text("capability_key").notNull(),
    mediaType: text("media_type").notNull().default("_"),
    connectionId: text("connection_id")
      .notNull()
      .references(() => serviceConnections.id, { onDelete: "cascade" }),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.capabilityKey, table.mediaType] })],
);

export const insertPrimaryConnectionSchema = createInsertSchema(primaryConnections);
export const selectPrimaryConnectionSchema = createSelectSchema(primaryConnections);
