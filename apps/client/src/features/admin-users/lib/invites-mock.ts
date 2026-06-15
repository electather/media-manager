import { useSyncExternalStore } from "react";
import type { AdminInvite } from "./types";

// Client-side mock store for invites. Backend endpoints (POST /admin/invites,
// GET /admin/invites, etc.) are not implemented yet; once they ship, replace
// usage of this store with React Query hooks against the real API. The invite
// links generated here are dead in production until then; gating this module
// behind a feature flag before GA is tracked in #658.

const DAY = 24 * 60 * 60 * 1000;

let invites: AdminInvite[] = seedInvites();
const listeners = new Set<() => void>();

function seedInvites(): AdminInvite[] {
  const now = Date.now();
  return [
    {
      id: "inv_seed_a",
      email: "leah@friends.xyz",
      roleId: "role_member",
      invitedBy: "u_self",
      createdAt: now - 20 * 60 * 60 * 1000,
      expiresAt: now + 7 * DAY - 20 * 60 * 60 * 1000,
      kind: "email",
    },
    {
      id: "inv_seed_b",
      email: null,
      roleId: "role_viewer",
      invitedBy: "u_self",
      createdAt: now - 44 * 60 * 60 * 1000,
      expiresAt: now + 14 * DAY - 44 * 60 * 60 * 1000,
      kind: "link",
      code: "k7qP-r2bM-Yh4d",
      uses: 1,
      maxUses: 5,
    },
    {
      id: "inv_seed_c",
      email: "noah@workplace.io",
      roleId: "role_member",
      invitedBy: "u_self",
      createdAt: now - 9 * DAY,
      expiresAt: now - 2 * DAY,
      kind: "email",
      expired: true,
    },
  ];
}

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function snapshot() {
  return invites;
}

export function useInvitesMock(): AdminInvite[] {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function randomId(prefix = "inv_") {
  return prefix + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function generateInviteCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(9));
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 6)}-${hex.slice(6, 12)}-${hex.slice(12, 18)}`;
}

export function createEmailInvitesMock(
  emails: string[],
  roleId: string,
  expiresAt: number,
): AdminInvite[] {
  const created: AdminInvite[] = emails.map((email) => ({
    id: randomId(),
    email,
    roleId,
    invitedBy: "u_self",
    createdAt: Date.now(),
    expiresAt,
    kind: "email",
  }));
  invites = [...created, ...invites];
  emit();
  return created;
}

export function createLinkInviteMock(
  roleId: string,
  expiresAt: number,
  maxUses: number,
  code: string,
): AdminInvite {
  const inv: AdminInvite = {
    id: randomId(),
    email: null,
    roleId,
    invitedBy: "u_self",
    createdAt: Date.now(),
    expiresAt,
    kind: "link",
    code,
    uses: 0,
    maxUses,
  };
  invites = [inv, ...invites];
  emit();
  return inv;
}

export function resendInviteMock(id: string) {
  invites = invites.map((i) =>
    i.id === id
      ? { ...i, createdAt: Date.now(), expiresAt: Date.now() + 7 * DAY, expired: false }
      : i,
  );
  emit();
}

export function revokeInviteMock(id: string) {
  invites = invites.filter((i) => i.id !== id);
  emit();
}

export function inviteUrl(code: string) {
  return `${window.location.origin}/invite/${code}`;
}
