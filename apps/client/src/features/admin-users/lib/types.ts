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

// Selectable roles in the invite drawer and user-detail role picker, in display
// order. Mirrors the seed roles in features/admin-roles. The backend exposes no
// list-roles endpoint yet; once `GET /api/admin/roles` lands, replace this static
// list with the fetched roles. Names and descriptions live in the
// admin_users_role_name / admin_users_role_description Paraglide variants, which
// are keyed on these ids.
export const ADMIN_USER_ROLE_IDS = ["role_admin", "role_member", "role_viewer"] as const;

export type AdminUserRoleId = (typeof ADMIN_USER_ROLE_IDS)[number];

/** Narrows an arbitrary role id to one of the statically known, selectable roles. */
export function isAdminUserRoleId(id: string | null | undefined): id is AdminUserRoleId {
  return ADMIN_USER_ROLE_IDS.includes(id as AdminUserRoleId);
}

/** Matches the AdminInviteDTO shape returned by the server. */
export interface AdminInvite {
  id: string;
  /** The invite code (bearer token). Always present for link invites. */
  code: string;
  /** Full invite URL constructed server-side. */
  url: string;
  roleId: string;
  /** User ID of the creating admin. Null when the admin has been deleted. */
  invitedBy: string | null;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  /** Server-computed: true when expired, exhausted, or revoked. */
  expired: boolean;
}

// AdminUsersApiError carries status/body/code for mutation error toasts
// (use-assign-role.ts, use-delete-user.ts). Render errors from Suspense reads
// bubble to SettingsErrorBoundary which shows error.message — the typed fields
// are not consumed there. A feature-local boundary that narrows on 403/404 is a
// future improvement; the shared boundary is acceptable for now.
export class AdminUsersApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminUsersApiError", status, body, `admin users request failed (${status})`);
  }
}
