import { ChevronRightIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { cn } from "@/shared/lib/utils";

import { ALL_PERMISSION_KEYS } from "../lib/permission-tree";
import type { RoleRecord } from "../lib/types";
import { RoleGlyph } from "./role-glyph";

interface Props {
  role: RoleRecord;
  memberCount: number;
  isFirst: boolean;
  onOpen: () => void;
}

export function RoleRow({ role, memberCount, isFirst, onOpen }: Props) {
  const all = role.permissions === "*";
  const permCount = all ? ALL_PERMISSION_KEYS.length : role.permissions.length;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "grid w-full grid-cols-[auto_minmax(0,1fr)_auto_24px] items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-muted/40",
        !isFirst && "border-t border-border",
      )}
    >
      <RoleGlyph roleId={role.id} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{role.name}</span>
          {role.isSystem ? (
            <Badge variant="outline" className="text-[10px] text-muted-foreground">
              {m.admin_roles_badge_system()}
            </Badge>
          ) : null}
          {role.id === "role_admin" ? (
            <Badge variant="outline" className="text-[10px] border-primary/40 text-primary">
              {m.admin_roles_badge_all_perms()}
            </Badge>
          ) : null}
        </div>
        <p className="mt-1 max-w-prose text-xs text-muted-foreground">{role.description}</p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/80">
          {permCount} permissions
        </p>
      </div>
      <div className="flex flex-col items-end gap-0.5 text-right">
        <span className="font-mono text-sm tabular-nums text-foreground">{memberCount}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {memberCount === 1 ? m.admin_roles_members_one() : m.admin_roles_members_many()}
        </span>
      </div>
      <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden="true" />
    </button>
  );
}
