import { and, eq, inArray, type SQL } from "drizzle-orm";
import { getDb } from "../../db/client";
import { rolePermissions, roles, userRoles } from "../../db/schema/roles";
import type { Permission } from "../types";

export interface UserRoleRow {
  roleId: string;
  isSystem: number;
  name: string;
}

/** Returns the role row for `userId`, or `null` when no role is assigned. */
export async function findUserRole(userId: string): Promise<UserRoleRow | null> {
  const db = getDb();
  const row = await db
    .select({ roleId: userRoles.roleId, isSystem: roles.isSystem, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();
  return row ?? null;
}

/** Returns `true` when `roleId` has `permission` in its permission set. */
export async function checkRolePermission(
  roleId: string,
  permission: Permission,
): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, roleId), eq(rolePermissions.permission, permission)))
    .get();
  return !!row;
}

// Shared base query: rolePermissions ⟶ userRoles filtered by permission + optional user subset.
async function selectUsersByPermission(
  permission: Permission,
  extraWhere?: SQL,
): Promise<string[]> {
  const db = getDb();
  const where: SQL = extraWhere
    ? and(extraWhere, eq(rolePermissions.permission, permission))!
    : eq(rolePermissions.permission, permission);
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(where)
    .all();
  return rows.map((r) => r.userId);
}

/** Returns de-duplicated user ids that hold `permission` via any role. */
export async function listUsersWithPermission(permission: Permission): Promise<string[]> {
  return Array.from(new Set(await selectUsersByPermission(permission)));
}

/** Returns the subset of `userIds` whose roles currently grant `permission`. */
export async function filterUsersWithPermission(
  userIds: string[],
  permission: Permission,
): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  return new Set(await selectUsersByPermission(permission, inArray(userRoles.userId, userIds)));
}
