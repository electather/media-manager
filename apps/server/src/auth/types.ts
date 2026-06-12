export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "@ent-mcp/shared/auth";

/**
 * Stable slug stored in `roles.system_slug` for the built-in Admin role.
 * Identifies the unconditional-all-permissions role independently of its
 * display name.
 *
 * Server-only by design: no client surface references the admin slug today.
 * If a shared schema validator or `@ent-mcp/shared/auth` enum ever needs it,
 * move this constant to `packages/shared/` rather than re-exporting it.
 */
export const SYSTEM_ADMIN_ROLE_SLUG = "admin" as const;

export interface UserRoleInfo {
  roleId: string;
  isSystemAdmin: boolean;
}
