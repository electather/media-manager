export { PERMISSIONS, type Permission, ALL_PERMISSIONS } from "@ent-mcp/shared/auth";

/**
 * Stable slug stored in `roles.system_slug` for the built-in Admin role.
 * Identifies the unconditional-all-permissions role independently of its
 * display name.
 */
export const SYSTEM_ADMIN_ROLE_SLUG = "admin" as const;

export interface UserRoleInfo {
  roleId: string;
  isSystemAdmin: boolean;
}
