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

// AdminUsersApiError carries status/body/code so the fetcher layer can throw a
// typed error (it is bound via createReadJson in lib/fetchers.ts). Mutation
// onError handlers surface the message through the shared errorMessage helper,
// and render errors from Suspense reads bubble to SettingsErrorBoundary which
// shows error.message — the typed fields are not consumed there. A feature-local
// boundary that narrows on 403/404 is a future improvement; the shared boundary
// is acceptable for now.
export class AdminUsersApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminUsersApiError", status, body, `admin users request failed (${status})`);
  }
}
