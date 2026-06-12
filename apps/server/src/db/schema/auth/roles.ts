import { sqliteTable, text, integer, primaryKey } from "drizzle-orm/sqlite-core";
import { user } from "./auth";

export const roles = sqliteTable("roles", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** 1 = built-in role that cannot be deleted or renamed. */
  isSystem: integer("is_system").notNull().default(0),
  /**
   * Stable machine identifier for built-in roles (e.g. "admin"). Null for
   * user-created roles. Code that needs to single out a system role checks
   * this slug, never the display name.
   */
  systemSlug: text("system_slug").unique(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Stores which permissions a role has. The full permission list lives in code, not the DB. */
export const rolePermissions = sqliteTable(
  "role_permissions",
  {
    roleId: text("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    permission: text("permission").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.permission] })],
);

/** One row per user — enforces the single-role-per-user constraint. */
export const userRoles = sqliteTable("user_roles", {
  userId: text("user_id")
    .notNull()
    .unique()
    .references(() => user.id, { onDelete: "cascade" }),
  roleId: text("role_id")
    .notNull()
    .references(() => roles.id),
  assignedAt: integer("assigned_at").notNull(),
});
