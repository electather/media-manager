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

export const ADMIN_PERMISSIONS = [
  PERMISSIONS.ADMIN_USERS,
  PERMISSIONS.ADMIN_ROLES,
  PERMISSIONS.ADMIN_SERVER,
  PERMISSIONS.ADMIN_REQUESTS,
  PERMISSIONS.ADMIN_PLUGINS,
  PERMISSIONS.ADMIN_JOBS,
] as const satisfies Permission[];
