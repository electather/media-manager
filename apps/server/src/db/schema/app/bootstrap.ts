import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const appBootstrap = sqliteTable("app_bootstrap", {
  id: text("id").primaryKey(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  consumedAt: integer("consumed_at"),
});
