import type { Context, Next } from "hono";
import { eq, and } from "drizzle-orm";
import { auth } from "./config";
import { getDb } from "../db/client";
import { userRoles, roles, rolePermissions } from "../db/schema/roles";
import type { Permission } from "./permissions";

/** Hono middleware that validates the Better Auth session. */
export async function requireSession(c: Context, next: Next): Promise<void> {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.status(401);
    c.json({ error: "Unauthorized" });
    return;
  }
  c.set("session", session);
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
      c.status(401);
      c.json({ error: "Unauthorized" });
      return;
    }

    const db = getDb();
    const userId = session.user.id;

    // Look up the user's assigned role.
    const userRole = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, userId))
      .get();

    if (!userRole) {
      c.status(403);
      c.json({ error: "Forbidden" });
      return;
    }

    // The system Admin role always has all permissions.
    const role = await db
      .select({ isSystem: roles.isSystem, name: roles.name })
      .from(roles)
      .where(eq(roles.id, userRole.roleId))
      .get();

    if (role?.isSystem === 1 && role.name === "Admin") {
      await next();
      return;
    }

    // Fall back to checking the role's explicit permission rows.
    const allowed = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(
          eq(rolePermissions.roleId, userRole.roleId),
          eq(rolePermissions.permission, permission),
        ),
      )
      .get();

    if (!allowed) {
      c.status(403);
      c.json({ error: "Forbidden" });
      return;
    }

    await next();
  };
}
