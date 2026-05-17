import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { rolePermissions, userRoles } from "../db/schema/roles";
import type { Permission } from "./permissions";

/**
 * Returns user ids that hold `permission` via any role assignment. De-duplicated.
 * Used by `notifications` to resolve recipients for admin-audience events.
 */
export async function listUsersHavingPermission(permission: Permission): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(eq(rolePermissions.permission, permission))
    .all();
  return Array.from(new Set(rows.map((r) => r.userId)));
}

/**
 * Subset of `userIds` whose roles grant `permission`. Used by `notifications`
 * for defense-in-depth re-check at dispatch time so a permission revoked between
 * emit and delivery does not leak through.
 */
export async function usersHavingPermission(
  userIds: string[],
  permission: Permission,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const db = getDb();
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(inArray(userRoles.userId, userIds), eq(rolePermissions.permission, permission)))
    .all();
  return new Set(rows.map((r) => r.userId));
}
