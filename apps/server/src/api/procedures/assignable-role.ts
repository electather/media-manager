import { eq } from "drizzle-orm";
import { roleHasAdminTierPermission, SYSTEM_ADMIN_ROLE_SLUG } from "../../auth";
import { getDb } from "../../db/client";
import { roles } from "../../db/schema/auth/roles";
import { badRequest, forbidden } from "../../diagnostics/http-errors";

/**
 * Resolves `roleId` and throws 400 when the role does not exist.
 * Returns the role's `id` and `systemSlug`.
 */
export async function requireRole(
  roleId: string,
): Promise<{ id: string; systemSlug: string | null }> {
  const db = getDb();
  const roleExists = await db
    .select({ id: roles.id, systemSlug: roles.systemSlug })
    .from(roles)
    .where(eq(roles.id, roleId))
    .get();
  if (!roleExists) {
    throw badRequest("users.role_not_found", `role ${roleId} does not exist`, { roleId });
  }
  return roleExists;
}

/**
 * Resolves `roleId` and rejects when it is admin-equivalent — either the system
 * Admin slug or any role holding an admin-tier permission (any `admin:*`
 * permission in `ADMIN_PERMISSIONS`: users, roles, server, requests, plugins,
 * jobs). Guards on capability, not slug, so a custom role that grants admin
 * power cannot be handed out through these endpoints (issue #576).
 *
 * Capability is resolved through the auth service barrel; the role's permission
 * set stays behind the auth/repo boundary.
 *
 * Lives under `api/procedures/` (not `auth/`): it imports
 * `roleHasAdminTierPermission` from the auth barrel, and the barrel deliberately
 * does not re-export `auth/internal/**`, so the guard stays on the API side of
 * that boundary.
 */
export async function requireAssignableRole(roleId: string): Promise<void> {
  const role = await requireRole(roleId);
  // The slug case keeps its own code so the long-standing "system role" message
  // and its test stay intact; the capability case is reported distinctly.
  if (role.systemSlug === SYSTEM_ADMIN_ROLE_SLUG) {
    throw forbidden("users.system_role", "Admin role cannot be assigned via this endpoint");
  }
  if (await roleHasAdminTierPermission(role.id, role.systemSlug)) {
    throw forbidden(
      "users.admin_role",
      "Roles granting admin-tier permissions cannot be assigned via this endpoint",
    );
  }
}
