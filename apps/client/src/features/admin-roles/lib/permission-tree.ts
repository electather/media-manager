import { m } from "@/paraglide/messages";

export type PermissionScope = "media" | "account" | "admin";

export interface PermissionLeaf {
  key: string;
  label: () => string;
  description: () => string;
}

export interface PermissionGroupDef {
  scope: PermissionScope;
  label: () => string;
  description: () => string;
  permissions: ReadonlyArray<PermissionLeaf>;
}

export const PERMISSION_TREE: ReadonlyArray<PermissionGroupDef> = [
  {
    scope: "media",
    label: () => m.admin_roles_scope_media(),
    description: () => m.admin_roles_scope_media_description(),
    permissions: [
      {
        key: "media:discover",
        label: () => m.admin_roles_perm_media_discover(),
        description: () => m.admin_roles_perm_media_discover_description(),
      },
      {
        key: "media:details",
        label: () => m.admin_roles_perm_media_details(),
        description: () => m.admin_roles_perm_media_details_description(),
      },
      {
        key: "media:request",
        label: () => m.admin_roles_perm_media_request(),
        description: () => m.admin_roles_perm_media_request_description(),
      },
      {
        key: "media:activity",
        label: () => m.admin_roles_perm_media_activity(),
        description: () => m.admin_roles_perm_media_activity_description(),
      },
      {
        key: "media:feedback",
        label: () => m.admin_roles_perm_media_feedback(),
        description: () => m.admin_roles_perm_media_feedback_description(),
      },
    ],
  },
  {
    scope: "account",
    label: () => m.admin_roles_scope_account(),
    description: () => m.admin_roles_scope_account_description(),
    permissions: [
      {
        key: "account:connections",
        label: () => m.admin_roles_perm_account_connections(),
        description: () => m.admin_roles_perm_account_connections_description(),
      },
      {
        key: "account:profile",
        label: () => m.admin_roles_perm_account_profile(),
        description: () => m.admin_roles_perm_account_profile_description(),
      },
    ],
  },
  {
    scope: "admin",
    label: () => m.admin_roles_scope_admin(),
    description: () => m.admin_roles_scope_admin_description(),
    permissions: [
      {
        key: "admin:users",
        label: () => m.admin_roles_perm_admin_users(),
        description: () => m.admin_roles_perm_admin_users_description(),
      },
      {
        key: "admin:roles",
        label: () => m.admin_roles_perm_admin_roles(),
        description: () => m.admin_roles_perm_admin_roles_description(),
      },
      {
        key: "admin:server",
        label: () => m.admin_roles_perm_admin_server(),
        description: () => m.admin_roles_perm_admin_server_description(),
      },
      {
        key: "admin:requests",
        label: () => m.admin_roles_perm_admin_requests(),
        description: () => m.admin_roles_perm_admin_requests_description(),
      },
      {
        key: "admin:plugins",
        label: () => m.admin_roles_perm_admin_plugins(),
        description: () => m.admin_roles_perm_admin_plugins_description(),
      },
      {
        key: "admin:jobs",
        label: () => m.admin_roles_perm_admin_jobs(),
        description: () => m.admin_roles_perm_admin_jobs_description(),
      },
    ],
  },
];

export const ALL_PERMISSION_KEYS: ReadonlyArray<string> = PERMISSION_TREE.flatMap((g) =>
  g.permissions.map((p) => p.key),
);
