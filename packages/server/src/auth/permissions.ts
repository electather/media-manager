/** Code-defined permission keys. Adding a new permission requires a code change because it must gate something. */
export const PERMISSIONS = {
  // Media permissions.
  MEDIA_DISCOVER: "media:discover",
  MEDIA_DETAILS: "media:details",
  MEDIA_REQUEST: "media:request",
  MEDIA_ACTIVITY: "media:activity",
  MEDIA_FEEDBACK: "media:feedback",
  // Account permissions.
  ACCOUNT_CONNECTIONS: "account:connections",
  ACCOUNT_PROFILE: "account:profile",
  // Admin permissions.
  ADMIN_USERS: "admin:users",
  ADMIN_ROLES: "admin:roles",
  ADMIN_SERVER: "admin:server",
  ADMIN_REQUESTS: "admin:requests",
  ADMIN_PLUGINS: "admin:plugins",
  ADMIN_JOBS: "admin:jobs",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

/** Permission groups used by the dashboard to render toggles per role. */
export const PERMISSION_GROUPS: Array<{ label: string; permissions: Permission[] }> = [
  {
    label: "Media",
    permissions: [
      PERMISSIONS.MEDIA_DISCOVER,
      PERMISSIONS.MEDIA_DETAILS,
      PERMISSIONS.MEDIA_REQUEST,
      PERMISSIONS.MEDIA_ACTIVITY,
      PERMISSIONS.MEDIA_FEEDBACK,
    ],
  },
  {
    label: "Account",
    permissions: [PERMISSIONS.ACCOUNT_CONNECTIONS, PERMISSIONS.ACCOUNT_PROFILE],
  },
  {
    label: "Admin",
    permissions: [
      PERMISSIONS.ADMIN_USERS,
      PERMISSIONS.ADMIN_ROLES,
      PERMISSIONS.ADMIN_SERVER,
      PERMISSIONS.ADMIN_REQUESTS,
      PERMISSIONS.ADMIN_PLUGINS,
      PERMISSIONS.ADMIN_JOBS,
    ],
  },
];
