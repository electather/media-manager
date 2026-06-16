import { useState } from "react";
import { PlusIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { AdminPageHeader } from "@/shared/components/admin-page-header";
import { Button } from "@/shared/ui/button";
import { authClient } from "@/shared/lib/auth";

import { useAdminUsers } from "../hooks/use-admin-users";
import { useInvitesMock } from "../lib/invites-mock";
import type { AdminUsersFilter } from "../lib/types";
import { deriveUserCounts } from "../lib/user-predicates";
import { InviteDrawer } from "./invite-drawer";
import { UserDetailRoute } from "./user-detail";
import { UsersList } from "./users-list";

export interface UsersPageProps {
  selectedUserId: string | null;
  onSelectUser: (id: string | null) => void;
}

export function UsersPage({ selectedUserId, onSelectUser }: UsersPageProps) {
  const session = authClient.useSession();
  const selfId = session.data?.user?.id ?? null;
  const { data } = useAdminUsers();
  const invites = useInvitesMock();
  const users = data.users;

  const [filter, setFilter] = useState<AdminUsersFilter>("all");
  const [query, setQuery] = useState("");
  const [inviteOpen, setInviteOpen] = useState(false);

  if (selectedUserId) {
    return (
      <UserDetailRoute userId={selectedUserId} selfId={selfId} onBack={() => onSelectUser(null)} />
    );
  }

  const {
    active: activeCount,
    admins: adminCount,
    pending: pendingCount,
  } = deriveUserCounts(users, invites, Date.now());

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader title={m.admin_users_title()} description={m.admin_users_description()} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {m.admin_users_count_summary({
            active: String(activeCount),
            admins: String(adminCount),
            pending: String(pendingCount),
          })}
        </p>
        <Button onClick={() => setInviteOpen(true)}>
          <PlusIcon aria-hidden="true" />
          {m.admin_users_invite_cta()}
        </Button>
      </div>

      <UsersList
        users={users}
        invites={invites}
        filter={filter}
        query={query}
        selfId={selfId}
        onFilterChange={setFilter}
        onQueryChange={setQuery}
        onOpenUser={onSelectUser}
      />

      <InviteDrawer open={inviteOpen} onClose={() => setInviteOpen(false)} />
    </div>
  );
}
