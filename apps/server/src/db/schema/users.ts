// @owner: auth
// Re-export Zod schemas derived from the Better Auth user table.
// The table itself is defined in auth.ts alongside the other auth tables.
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { user } from "./auth";

export const insertUserSchema = createInsertSchema(user);
export const selectUserSchema = createSelectSchema(user);
