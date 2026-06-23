import type { ApiErrorBody } from "@/shared/lib/diagnostics/api-error-body";
import { BaseApiError } from "@/shared/lib/diagnostics/api-error";

export interface AdminUserSummary {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
  role: { id: string; name: string | null } | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  activeSessions: number;
}

export type AdminUsersFilter = "all" | "admins" | "invites";

// TODO: replace with fetched roles from `GET /api/admin/roles` when available.
// Names/descriptions keyed on these ids in Paraglide variants.
export const ADMIN_USER_ROLE_IDS = ["role_admin", "role_member", "role_viewer"] as const;

export type AdminUserRoleId = (typeof ADMIN_USER_ROLE_IDS)[number];

/** Narrows an arbitrary role id to one of the statically known, selectable roles. */
export function isAdminUserRoleId(id: string | null | undefined): id is AdminUserRoleId {
  return ADMIN_USER_ROLE_IDS.includes(id as AdminUserRoleId);
}

export interface AdminInvite {
  id: string;
  /** Always set for link invites (the only active kind). */
  code: string;
  /** Absolute invite URL constructed server-side; copy directly without prepending origin. */
  url: string;
  roleId: string;
  /** Null when the creating admin has since been deleted. */
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  uses: number;
  maxUses: number;
  /** Server-computed: expiresAt < now OR uses >= maxUses OR revokedAt != null. */
  expired: boolean;
}

// Carries status/body/code for typed error routing in fetcher layer (createReadJson).
// Only error.message is consumed by SettingsErrorBoundary; feature-local 403/404
// narrowing is a future improvement.
export class AdminUsersApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminUsersApiError", status, body, `admin users request failed (${status})`);
  }
}
