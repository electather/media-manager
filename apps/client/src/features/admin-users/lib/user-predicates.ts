import type { AdminInvite, AdminUserSummary } from "./types";

/**
 * Returns true when the invite is still active. Uses the server-computed
 * `expired` flag which encodes `expiresAt < now OR uses >= maxUses OR
 * revokedAt != null` — no client-side timestamp recomputation needed.
 */
export function isInviteActive(invite: AdminInvite): boolean {
  return !invite.expired;
}

/** Returns true when the user holds the admin role. */
export function isAdmin(user: AdminUserSummary): boolean {
  return user.role?.id === "role_admin";
}

/** Derives the summary counts shown in the page header and filter chips. */
export function deriveUserCounts(
  users: AdminUserSummary[],
  invites: AdminInvite[],
): { active: number; admins: number; pending: number } {
  return {
    active: users.length,
    admins: users.filter(isAdmin).length,
    pending: invites.filter(isInviteActive).length,
  };
}
