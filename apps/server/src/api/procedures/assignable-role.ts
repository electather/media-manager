/**
 * Shared role-assignability guard. Imported by both `users.ts` and
 * `invites.ts` so the same escalation-prevention logic is enforced on
 * every code path that creates accounts or assigns roles.
 *
 * Lives under `api/procedures/` (not `auth/`) because it imports
 * `roleHasAdminTierPermission` from the auth barrel; that function lives
 * behind the barrel boundary (the barrel does not re-export `auth/repo`
 * internals), so the guard must stay on the API side of that boundary.
 */
import { roleHasAdminTierPermission, SYSTEM_ADMIN_ROLE_SLUG } from "../../auth";
import { getDb } from "../../db/client";
import { roles } from "../../db/schema/auth/roles";
import { eq } from "drizzle-orm";
import { badRequest, forbidden } from "../../diagnostics/http-errors";

/**
 * Resolves `roleId` from the database and throws a 400 when the role does not
 * exist. Returns the id + systemSlug pair needed by `requireAssignableRole`.
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
 * Resolves `roleId` and rejects when it is admin-equivalent — either the
 * system Admin slug or any role holding an admin-tier permission (any
 * `admin:*` permission). Guards on capability, not slug, so a custom role
 * that grants admin power cannot be handed out (issue #576).
 *
 * Capability is resolved through the auth service barrel; the role's
 * permission set stays behind the auth/repo boundary.
 */
export async function requireAssignableRole(roleId: string): Promise<void> {
  const role = await requireRole(roleId);
  // Slug check keeps its own code path so the original "system role" error
  // code stays intact for existing tests.
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
