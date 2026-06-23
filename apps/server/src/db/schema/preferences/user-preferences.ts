import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "../auth/auth";
import { serviceConnections } from "../plugin-runtime/credentials";

/**
 * Per-user primary-connection selection for `primary_with_enrichment` capabilities (e.g., metadata@v1).
 * Keyed by `(userId, capabilityKey, mediaType)` where mediaType is "movie"|"tv"|"_" (unsegmented).
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
