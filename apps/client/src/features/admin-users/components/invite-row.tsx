// fallow-ignore-file complexity
import { BellIcon, CopyIcon, LinkIcon, RotateCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { relativeTime } from "@/shared/lib/relative-time";
import { cn } from "@/shared/lib/utils";

import { inviteUrl, resendInviteMock, revokeInviteMock } from "../lib/invites-mock";
import type { AdminInvite } from "../lib/types";
import { RoleTag } from "./role-tag";

interface Props {
  invite: AdminInvite;
  role: { id: string; name: string } | null;
  isFirst: boolean;
}

export function InviteRow({ invite, role, isFirst }: Props) {
  const expired = invite.expired || invite.expiresAt < Date.now();

  const onCopy = async () => {
    if (!invite.code) return;
    try {
      await navigator.clipboard.writeText(inviteUrl(invite.code));
      toast.success(m.admin_users_invite_toast_copied());
    } catch {
      // Clipboard API may be denied by the browser; silently ignore.
    }
  };

  const onResend = () => {
    resendInviteMock(invite.id);
    toast.success(m.admin_users_invite_toast_resent());
  };

  const onRevoke = () => {
    revokeInviteMock(invite.id);
    toast.success(m.admin_users_invite_toast_revoked());
  };

  const usesBadge =
    invite.kind === "link" && invite.maxUses !== undefined
      ? Number(invite.maxUses) === 0
        ? m.admin_users_invite_uses_unlimited_badge()
        : m.admin_users_invite_uses_progress({
            used: String(invite.uses ?? 0),
            max: String(invite.maxUses),
          })
      : null;

  return (
    <div
      className={cn(
        "grid grid-cols-[minmax(0,1fr)_110px_auto] items-center gap-3 px-4 py-3",
        !isFirst && "border-t border-border",
        expired && "opacity-70",
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div
          className="flex size-9 shrink-0 items-center justify-center rounded-full border border-dashed border-border bg-muted/40 text-muted-foreground"
          aria-hidden="true"
        >
          {invite.kind === "link" ? (
            <LinkIcon className="size-4" />
          ) : (
            <BellIcon className="size-4" />
          )}
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            {invite.kind === "email" ? (
              <span className="truncate font-mono text-sm text-foreground">{invite.email}</span>
            ) : (
              <span className="text-sm text-foreground">
                {m.admin_users_invite_kind_link_label()}{" "}
                <span className="font-mono text-xs text-muted-foreground">·{invite.code}</span>
              </span>
            )}
            {expired ? (
              <Badge variant="outline" className="border-destructive/40 text-destructive">
                {m.admin_users_invite_expired()}
              </Badge>
            ) : null}
            {!expired && usesBadge ? <Badge variant="outline">{usesBadge}</Badge> : null}
          </div>
          <div className="mt-0.5 text-xs text-muted-foreground">
            {m.admin_users_invite_sent_at({
              time: relativeTime(invite.createdAt),
              expiry: expired
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
        {invite.kind === "link" && !expired ? (
          <Button variant="ghost" size="sm" onClick={() => void onCopy()}>
            <CopyIcon aria-hidden="true" />
            {m.admin_users_invite_copy()}
          </Button>
        ) : null}
        {invite.kind === "email" && !expired ? (
          <Button variant="ghost" size="sm" onClick={onResend}>
            <RotateCwIcon aria-hidden="true" />
            {m.admin_users_invite_resend()}
          </Button>
        ) : null}
        <Button variant="outline" size="sm" onClick={onRevoke}>
          <XIcon aria-hidden="true" />
          {m.admin_users_invite_revoke()}
        </Button>
      </div>
    </div>
  );
}
