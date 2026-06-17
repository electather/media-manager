// fallow-ignore-file complexity
import { CopyIcon, LinkIcon, RotateCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/time-format";
import { cn } from "@/shared/lib/utils";

import { useExtendInvite } from "../hooks/use-extend-invite";
import { useRevokeInvite } from "../hooks/use-revoke-invite";
import type { AdminInvite } from "../lib/types";
import { RoleTag } from "./role-tag";

interface Props {
  invite: AdminInvite;
  role: { id: string; name: string } | null;
  isFirst: boolean;
}

const DAY = 24 * 60 * 60 * 1000;

export function InviteRow({ invite, role, isFirst }: Props) {
  const extendMutation = useExtendInvite();
  const revokeMutation = useRevokeInvite();

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      toast.success(m.admin_users_invite_toast_copied());
    } catch {
      // Clipboard API may be denied by the browser; silently ignore.
    }
  };

  const onExtend = () => {
    // Extend by 7 days from now.
    extendMutation.mutate({ id: invite.id, expiresAt: Date.now() + 7 * DAY });
  };

  const onRevoke = () => {
    revokeMutation.mutate(invite.id);
  };

  const usesBadge =
    invite.maxUses === 0
      ? m.admin_users_invite_uses_unlimited_badge()
      : m.admin_users_invite_uses_progress({
          used: String(invite.uses),
          max: String(invite.maxUses),
        });

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 px-4 py-3",
        !isFirst && "border-t border-border",
        invite.expired && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted/40 text-muted-foreground"
          aria-hidden="true"
        >
          <LinkIcon className="size-4" />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm text-foreground">
              {m.admin_users_invite_kind_link_label()}{" "}
              <span className="font-mono text-xs text-muted-foreground">·{invite.code}</span>
            </span>
            {invite.expired ? (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                {m.admin_users_invite_expired()}
              </Badge>
            ) : null}
            {!invite.expired ? <Badge variant="outline">{usesBadge}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {m.admin_users_invite_sent_at({
              time: relativeTime(invite.createdAt),
              expiry: invite.expired
                ? m.admin_users_invite_expired()
                : m.admin_users_invite_expires_in({ time: relativeTime(invite.expiresAt) }),
            })}
          </div>
        </div>
      </div>
      <div>
        <RoleTag role={role} />
      </div>
      <div className="flex items-center gap-2 justify-self-end">
        {!invite.expired ? (
          <Button variant="ghost" size="sm" onClick={() => void onCopy()}>
            <CopyIcon aria-hidden="true" />
            {m.admin_users_invite_copy()}
          </Button>
        ) : null}
        {invite.expired ? (
          <Button variant="ghost" size="sm" onClick={onExtend} disabled={extendMutation.isPending}>
            <RotateCwIcon aria-hidden="true" />
            {m.admin_users_invite_extend()}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRevoke} disabled={revokeMutation.isPending}>
          <XIcon aria-hidden="true" />
          {m.admin_users_invite_revoke()}
        </Button>
      </div>
    </div>
  );
}
