import { useMemo } from "react";
import { groupBy } from "es-toolkit";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";
import { AdminPageHeader } from "@/shared/components/admin-page-header";
import { Button } from "@/shared/ui/button";

import { useAdminUsers } from "@/features/admin-users/hooks/use-admin-users";

import { createRoleMock, useRolesMock } from "../lib/roles-store";
import type { RoleMember, RoleRecord } from "../lib/types";
import { RoleDetail } from "./role-detail";
import { RoleRow } from "./role-row";

interface Props {
  selectedRoleId: string | null;
  onSelectRole: (id: string | null) => void;
}

export function RolesPage({ selectedRoleId, onSelectRole }: Props) {
  const roles = useRolesMock();
  const usersQuery = useAdminUsers();

  // Precompute a map from role id to members so each row lookup is O(1) instead
  // of re-filtering the full user list on every render.
  const membersByRole = useMemo(
    () =>
      groupBy(
        usersQuery.data.users.filter(
          (u): u is typeof u & { role: { id: string; name: string | null } } => u.role != null,
        ),
        (u) => u.role.id,
      ),
    [usersQuery.data.users],
  );

  const memberCount = (id: string) => membersByRole[id]?.length ?? 0;
  const membersFor = (id: string): RoleMember[] =>
    (membersByRole[id] ?? []).map(({ id, name, email }) => ({ id, name, email }));

  const selected = selectedRoleId ? (roles.find((r) => r.id === selectedRoleId) ?? null) : null;

  if (selected) {
    return (
      <RoleDetail
        role={selected}
        members={membersFor(selected.id)}
        onBack={() => onSelectRole(null)}
      />
    );
  }

  const onCreate = () => {
    const next = createRoleMock();
    toast.success(m.admin_roles_toast_created());
    onSelectRole(next.id);
  };

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={m.admin_roles_title()} description={m.admin_roles_description()} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {m.admin_roles_count_summary({
            system: String(roles.filter((r) => r.isSystem).length),
            custom: String(roles.filter((r) => !r.isSystem).length),
          })}
        </p>
        <Button onClick={onCreate}>
          <PlusIcon aria-hidden="true" />
          {m.admin_roles_create_cta()}
        </Button>
      </div>

      <RoleGroup
        label={m.admin_roles_group_system()}
        hint={m.admin_roles_group_system_hint()}
        items={roles.filter((r) => r.isSystem)}
        memberCount={memberCount}
        onOpen={onSelectRole}
      />

      <RoleGroup
        label={m.admin_roles_group_custom()}
        hint={m.admin_roles_group_custom_hint()}
        items={roles.filter((r) => !r.isSystem)}
        memberCount={memberCount}
        onOpen={onSelectRole}
      />
    </div>
  );
}

function RoleGroup({
  label,
  hint,
  items,
  memberCount,
  onOpen,
}: {
  label: string;
  hint: string;
  items: RoleRecord[];
  memberCount: (id: string) => number;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="flex items-baseline justify-between px-1 pb-2">
        <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {label}
        </div>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {items.map((r, i) => (
          <RoleRow
            key={r.id}
            role={r}
            memberCount={memberCount(r.id)}
            isFirst={i === 0}
            onOpen={() => onOpen(r.id)}
          />
        ))}
      </div>
    </div>
  );
}
