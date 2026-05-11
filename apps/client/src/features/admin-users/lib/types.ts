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

export type AdminInviteKind = "email" | "link";

export interface AdminInvite {
  id: string;
  email: string | null;
  roleId: string;
  invitedBy: string;
  createdAt: number;
  expiresAt: number;
  kind: AdminInviteKind;
  code?: string;
  uses?: number;
  maxUses?: number;
  expired?: boolean;
}

export class AdminUsersApiError extends BaseApiError {
  constructor(status: number, body: ApiErrorBody | null) {
    super("AdminUsersApiError", status, body, `admin users request failed (${status})`);
  }
}
