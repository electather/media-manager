// fallow-ignore-file complexity
import { useMemo } from "react";
import { SearchIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/shared/ui/input-group";
import { cn } from "@/shared/lib/utils";

import type { AdminInvite, AdminUserSummary, AdminUsersFilter } from "../lib/types";
import { InviteRow } from "./invite-row";
import { UserRow } from "./user-row";
import { roleSummaries } from "../lib/role-summaries";

interface Props {
  users: AdminUserSummary[];
  invites: AdminInvite[];
  filter: AdminUsersFilter;
  query: string;
  selfId: string | null;
  onFilterChange: (next: AdminUsersFilter) => void;
  onQueryChange: (next: string) => void;
  onOpenUser: (id: string) => void;
}

export function UsersList({
  users,
  invites,
  filter,
  query,
  selfId,
  onFilterChange,
  onQueryChange,
  onOpenUser,
}: Props) {
  const roles = roleSummaries();

  const counts = useMemo(
    () => ({
      all: users.length,
      admins: users.filter((u) => u.role?.id === "role_admin").length,
      invites: invites.filter((i) => !(i.expired || i.expiresAt < Date.now())).length,
    }),
    [users, invites],
  );

  const filtered = useMemo(() => {
    let list = users;
    if (filter === "admins") list = list.filter((u) => u.role?.id === "role_admin");
    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
      );
    }
    return list;
  }, [users, filter, query]);

  const showInvites = filter === "invites" || (filter === "all" && invites.length > 0);
  const inviteSlice = filter === "invites" ? invites : invites.slice(0, 3);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon className="size-4" aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={m.admin_users_search_placeholder()}
          />
        </InputGroup>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            active={filter === "all"}
            onClick={() => onFilterChange("all")}
            count={counts.all}
          >
            {m.admin_users_filter_all()}
          </FilterChip>
          <FilterChip
            active={filter === "admins"}
            onClick={() => onFilterChange("admins")}
            count={counts.admins}
          >
            {m.admin_users_filter_admins()}
          </FilterChip>
          <FilterChip
            active={filter === "invites"}
            onClick={() => onFilterChange("invites")}
            count={counts.invites}
          >
            {m.admin_users_filter_invites()}
          </FilterChip>
        </div>
      </div>

      {filter !== "invites" ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="grid grid-cols-[minmax(0,1fr)_110px_130px_24px] gap-3 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            <span>{m.admin_users_table_user()}</span>
            <span>{m.admin_users_table_role()}</span>
            <span>{m.admin_users_table_joined()}</span>
            <span />
          </div>
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {m.admin_users_no_match()}
            </div>
          ) : (
            filtered.map((u, i) => (
              <UserRow
                key={u.id}
                user={u}
                isSelf={u.id === selfId}
                isFirst={i === 0}
                onOpen={onOpenUser}
              />
            ))
          )}
        </div>
      ) : null}

      {showInvites ? (
        <InvitesSection
          invites={inviteSlice}
          rolesById={
            Object.fromEntries(roles.map((r) => [r.id, r])) as Record<
              string,
              { id: string; name: string }
            >
          }
          countLabelTotal={counts.invites}
          showHeader={filter !== "invites"}
          onSeeAll={() => onFilterChange("invites")}
        />
      ) : null}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  count,
  children,
}: {
  active: boolean;
  onClick: () => void;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      variant={active ? "secondary" : "ghost"}
      size="sm"
      onClick={onClick}
      className={cn("gap-1.5", active && "border border-border")}
    >
      {children}
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{count}</span>
    </Button>
  );
}

function InvitesSection({
  invites,
  rolesById,
  countLabelTotal,
  showHeader,
  onSeeAll,
}: {
  invites: AdminInvite[];
  rolesById: Record<string, { id: string; name: string }>;
  countLabelTotal: number;
  showHeader: boolean;
  onSeeAll: () => void;
}) {
  return (
    <div>
      {showHeader ? (
        <div className="flex items-center justify-between px-1 pb-2">
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {m.admin_users_pending_label({ count: String(countLabelTotal) })}
          </div>
          <Button variant="ghost" size="sm" onClick={onSeeAll}>
            {m.admin_users_pending_show_all()}
          </Button>
        </div>
      ) : null}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {invites.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            {m.admin_users_pending_empty()}
          </div>
        ) : (
          invites.map((inv, i) => (
            <InviteRow
              key={inv.id}
              invite={inv}
              role={rolesById[inv.roleId] ?? null}
              isFirst={i === 0}
            />
          ))
        )}
      </div>
    </div>
  );
}
