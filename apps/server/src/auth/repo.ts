import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import { user } from "../db/schema/auth";
import { rolePermissions, roles, userRoles } from "../db/schema/auth/roles";
import { SYSTEM_ADMIN_ROLE_SLUG, type Permission } from "./types";
import { ALL_PERMISSIONS } from "@nama/shared/auth";

export interface UserRoleRow {
  roleId: string;
  /** Stable identifier for built-in roles; `null` for user-created roles. */
  systemSlug: string | null;
}

/** Marks `userId` as having completed onboarding. */
export async function setUserOnboarded(userId: string): Promise<void> {
  const db = getDb();
  await db.update(user).set({ hasOnboarded: true }).where(eq(user.id, userId));
}

/** Returns whether `userId` has completed onboarding; `false` if not found. */
// A trivial select-one-column-by-id; it coincidentally matches other repos' read
// shape, but extracting a shared helper would couple unrelated tables.
// fallow-ignore-next-line code-duplication
export async function findUserOnboarded(userId: string): Promise<boolean> {
  const db = getDb();
  const row = await db
    .select({ hasOnboarded: user.hasOnboarded })
    .from(user)
    .where(eq(user.id, userId))
    .get();
  return row?.hasOnboarded ?? false;
}

/** Returns the role row for `userId`, or `null` when no role is assigned. */
export async function findUserRole(userId: string): Promise<UserRoleRow | null> {
  const db = getDb();
  const row = await db
    .select({ roleId: userRoles.roleId, systemSlug: roles.systemSlug })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();
  return row ?? null;
}

/** Returns the permissions granted to `userId` via their assigned role. */
export async function loadUserPermissions(userId: string): Promise<Permission[]> {
  const role = await findUserRole(userId);
  if (!role) return [];
  if (role.systemSlug === SYSTEM_ADMIN_ROLE_SLUG) return ALL_PERMISSIONS;
  const db = getDb();
  const rows = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(eq(rolePermissions.roleId, role.roleId))
    .all();
  return rows
    .map((r) => r.permission)
    .filter((p): p is Permission => (ALL_PERMISSIONS as readonly string[]).includes(p));
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

/** Returns `true` when `roleId` holds at least one of `permissions`. */
export async function roleHasAnyPermission(
  roleId: string,
  permissions: readonly Permission[],
): Promise<boolean> {
  if (permissions.length === 0) return false;
  const db = getDb();
  const row = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(
      and(
        eq(rolePermissions.roleId, roleId),
        inArray(rolePermissions.permission, permissions as Permission[]),
      ),
    )
    .get();
  return !!row;
}

// Shared query: rolePermissions ⟶ userRoles, filtered by permission + optional user-set condition.
// Avoids duplicating the join across listUsersWithPermission and filterUsersWithPermission.
async function selectUsersByPermission(
  permission: Permission,
  extraWhere?: ReturnType<typeof inArray>,
): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ userId: userRoles.userId })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(
      extraWhere
        ? and(extraWhere, eq(rolePermissions.permission, permission))
        : eq(rolePermissions.permission, permission),
    )
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
