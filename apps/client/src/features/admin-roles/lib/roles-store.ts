// fallow-ignore-file complexity
import { useSyncExternalStore } from "react";

import { m } from "@/paraglide/messages";
import { ALL_PERMISSION_KEYS } from "./permission-tree";
import type { RoleRecord } from "./types";

// Local mock store. Roles CRUD endpoints (`/api/admin/roles`) are not
// implemented yet; once they ship, replace this with React Query hooks
// against the real API. Backend already persists role assignments via
// `userRoles`, so existing role IDs (role_admin / role_member / etc.)
// must match what server-side migrations seed.

function seedRoles(): RoleRecord[] {
  const memberPerms = ALL_PERMISSION_KEYS.filter((k) => !k.startsWith("admin:"));
  return [
    {
      id: "role_admin",
      name: m.admin_roles_seed_admin_name(),
      description: m.admin_roles_seed_admin_description(),
      isSystem: true,
      permissions: "*",
    },
    {
      id: "role_member",
      name: m.admin_roles_seed_member_name(),
      description: m.admin_roles_seed_member_description(),
      isSystem: true,
      permissions: [...memberPerms],
    },
    {
      id: "role_viewer",
      name: m.admin_roles_seed_viewer_name(),
      description: m.admin_roles_seed_viewer_description(),
      isSystem: true,
      permissions: ["media:discover", "media:details", "media:activity"],
    },
    {
      // UI-only example role — backend seed only creates role_admin, role_member, role_viewer.
      id: "role_curator",
      name: m.admin_roles_seed_curator_name(),
      description: m.admin_roles_seed_curator_description(),
      isSystem: false,
      permissions: [
        "media:discover",
        "media:details",
        "media:request",
        "media:activity",
        "media:feedback",
        "account:profile",
        "admin:requests",
      ],
    },
  ];
}

// Module-level state resets on Vite HMR — expected while this is a mock store.
let roles: RoleRecord[] = seedRoles();
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const snapshot = () => roles;

export function useRolesMock() {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

function randomId() {
  return "role_" + crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export function saveRoleMock(updated: RoleRecord) {
  roles = roles.map((r) => (r.id === updated.id ? updated : r));
  emit();
}

export function createRoleMock(template?: Partial<RoleRecord>): RoleRecord {
  const next: RoleRecord = {
    id: randomId(),
    name: template?.name ?? m.admin_roles_default_new_name(),
    description: template?.description ?? m.admin_roles_default_new_description(),
    isSystem: false,
    permissions: template?.permissions ?? [],
  };
  roles = [...roles, next];
  emit();
  return next;
}

export function deleteRoleMock(id: string) {
  roles = roles.filter((r) => r.id !== id);
  emit();
}

export function duplicateRoleMock(source: RoleRecord): RoleRecord {
  const perms = source.permissions === "*" ? [...ALL_PERMISSION_KEYS] : [...source.permissions];
  return createRoleMock({
    name: `${source.name} (copy)`,
    description: source.description,
    permissions: perms,
  });
}
