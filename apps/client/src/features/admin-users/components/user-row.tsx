import { ChevronRightIcon } from "lucide-react";
import { useMemo } from "react";

import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { UserAvatar } from "@/shared/components/user-avatar";
import { cn } from "@/shared/lib/utils";

import type { AdminUserSummary } from "../lib/types";
import { RoleTag } from "./role-tag";

interface Props {
  user: AdminUserSummary;
  isSelf: boolean;
  isFirst: boolean;
  onOpen: (id: string) => void;
}

export function UserRow({ user, isSelf, isFirst, onOpen }: Props) {
  const joined = useMemo(
    () =>
      new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      }),
    [user.createdAt],
  );

  return (
    <button
      type="button"
      onClick={() => onOpen(user.id)}
      className={cn(
        "grid w-full grid-cols-[minmax(0,1fr)_110px_130px_24px] items-center gap-3 px-4 py-3 text-start transition-colors hover:bg-muted/40",
        !isFirst && "border-t border-border",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <UserAvatar name={user.name} email={user.email} className="size-9" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{user.name}</span>
            {isSelf ? (
              <Badge variant="outline" className="text-[10px]">
                {m.admin_users_you_badge()}
              </Badge>
            ) : null}
          </div>
          <div className="truncate font-mono text-xs text-muted-foreground">{user.email}</div>
        </div>
      </div>
      <div className="min-w-0">
        <RoleTag role={user.role} />
      </div>
      <div className="text-xs text-muted-foreground tabular-nums">{joined}</div>
      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
