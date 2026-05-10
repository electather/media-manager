import type { Context, Next } from "hono";
import { eq, and } from "drizzle-orm";
import { auth } from "./config";
import { getDb } from "../db/client";
import { userRoles, roles, rolePermissions } from "../db/schema/roles";
import type { Permission } from "./permissions";
import { currentRequestContext } from "../diagnostics/request-context";
import { forbidden, unauthorized } from "../diagnostics/http-errors";

interface UserRoleInfo {
  roleId: string;
  isSystemAdmin: boolean;
}

/** Loads the user's role row joined with `roles` so the system-Admin shortcut
 * can be evaluated without a follow-up query. Returns `null` when the user
 * has no role assigned. Centralised so the routes that need to gate on
 * permissions don't reimplement the join. */
export async function loadUserRole(userId: string): Promise<UserRoleInfo | null> {
  const db = getDb();
  const row = await db
    .select({ roleId: userRoles.roleId, isSystem: roles.isSystem, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();
  if (!row) return null;
  return {
    roleId: row.roleId,
    isSystemAdmin: row.isSystem === 1 && row.name === "Admin",
  };
}

/** Returns true when the given role row grants `permission`. The system Admin
 * role bypasses every check — same shortcut `requirePermission` enforces. */
export async function roleHasPermission(
  role: UserRoleInfo,
  permission: Permission,
): Promise<boolean> {
  if (role.isSystemAdmin) return true;
  const db = getDb();
  const allowed = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(and(eq(rolePermissions.roleId, role.roleId), eq(rolePermissions.permission, permission)))
    .get();
  return !!allowed;
}

/** Convenience: load + check in one call. Two queries; prefer
 * `loadUserRole` once + `roleHasPermission` per check when checking many
 * permissions for one user (e.g. the categories endpoint). */
export async function userHasPermission(userId: string, permission: Permission): Promise<boolean> {
  const role = await loadUserRole(userId);
  if (!role) return false;
  return roleHasPermission(role, permission);
}

/** Returns the authenticated user's id from the Hono context. */
export function sessionUserId(c: Context): string {
  const session = c.get("session") as { user: { id: string } } | undefined;
  if (!session) throw unauthorized();
  return session.user.id;
}

/** Hono middleware that validates the Better Auth session. */
export async function requireSession(c: Context, next: Next): Promise<void> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    throw unauthorized();
  }
  c.set("session", session);
  // Attach the user id to the ambient request context so captureError can correlate errors
  // back to the authenticated user without every caller passing it explicitly.
  const ctx = currentRequestContext();
  if (ctx) ctx.userId = session.user.id;
  await next();
}

/**
 * Returns a Hono middleware that checks the authenticated user has the required permission.
 * Must be used after requireSession so that c.get("session") is populated.
 *
 * The system Admin role bypasses all permission checks — this is enforced here in code,
 * not by rows in role_permissions.
 */
export function requirePermission(permission: Permission) {
  return async (c: Context, next: Next): Promise<void> => {
    const session = c.get("session") as { user: { id: string } } | undefined;
    if (!session) {
      throw unauthorized();
    }
    const role = await loadUserRole(session.user.id);
    if (!role) {
      throw forbidden();
    }
    if (!(await roleHasPermission(role, permission))) {
      throw forbidden();
    }
    await next();
  };
}
