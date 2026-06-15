import type { AdminInvite, AdminUserSummary } from "./types";

/** Returns true when the invite has not expired and the expiry timestamp has not passed. */
export function isInviteActive(invite: AdminInvite, now: number): boolean {
  return !(invite.expired || invite.expiresAt < now);
}

/** Returns true when the user holds the admin role. */
export function isAdmin(user: AdminUserSummary): boolean {
  return user.role?.id === "role_admin";
}

/** Derives the summary counts shown in the page header and filter chips. */
export function deriveUserCounts(
  users: AdminUserSummary[],
  invites: AdminInvite[],
  now: number,
): { active: number; admins: number; pending: number } {
  return {
    active: users.length,
    admins: users.filter(isAdmin).length,
    pending: invites.filter((i) => isInviteActive(i, now)).length,
  };
}
