import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sqliteTable, text as sqliteText, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";

// PostgreSQL variant — mirrors the table Better Auth manages.
export const usersPg = pgTable("users", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// SQLite variant.
export const usersSqlite = sqliteTable("users", {
  id: sqliteText("id").primaryKey(),
  name: sqliteText("name").notNull(),
  email: sqliteText("email").notNull().unique(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
});

export const insertUserPgSchema = createInsertSchema(usersPg);
export const selectUserPgSchema = createSelectSchema(usersPg);
