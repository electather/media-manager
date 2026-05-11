// fallow-ignore-file complexity
import { Suspense, useState } from "react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { ChevronLeftIcon, LogOutIcon, ShieldAlertIcon, TriangleAlertIcon } from "lucide-react";

import { m } from "@/paraglide/messages";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Separator } from "@/shared/ui/separator";
import { Skeleton } from "@/shared/ui/skeleton";
import { UserAvatar } from "@/shared/components/user-avatar";

import { fetchAdminUser } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";
import { useAssignRole } from "../hooks/use-assign-role";
import { useDeleteUser } from "../hooks/use-delete-user";
import { useRevokeSessions } from "../hooks/use-revoke-sessions";
import { roleSummaries } from "../lib/role-summaries";
import type { AdminUserDetail } from "../lib/types";
import { RoleTag } from "./role-tag";

interface Props {
  userId: string;
  selfId: string | null;
  onBack: () => void;
}

export function UserDetailRoute({ userId, selfId, onBack }: Props) {
  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start gap-1.5">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        {m.admin_users_detail_back()}
      </Button>
      <Suspense fallback={<UserDetailSkeleton />}>
        <UserDetail userId={userId} selfId={selfId} onBack={onBack} />
      </Suspense>
    </div>
  );
}

function UserDetailSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <Skeleton className="h-28 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-24 w-full rounded-xl" />
    </div>
  );
}

function UserDetail({ userId, selfId, onBack }: Omit<Props, "selfId"> & { selfId: string | null }) {
  const { data } = useSuspenseQuery({
    queryKey: adminUsersKeys.detail(userId),
    queryFn: () => fetchAdminUser(userId),
  });
  const user = data.user;
  const isSelf = selfId === user.id;
  const roles = roleSummaries();

  const assignRole = useAssignRole();
  const revokeSessions = useRevokeSessions();
  const deleteUser = useDeleteUser();

  const [confirm, setConfirm] = useState<"delete" | "revoke" | null>(null);

  const onChangeRole = (nextRoleId: string | null) => {
    if (!nextRoleId || nextRoleId === user.role?.id) return;
    const next = roles.find((r) => r.id === nextRoleId);
    if (!next) return;
    assignRole.mutate({ userId: user.id, roleId: nextRoleId, roleName: next.name });
  };

  const joined = new Date(user.createdAt).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  return (
    <div className="flex flex-col gap-6">
      <IdentityCard user={user} joined={joined} isSelf={isSelf} />

      <DetailSection
        title={m.admin_users_detail_role_title()}
        subtitle={m.admin_users_detail_role_subtitle()}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
          <div className="flex min-w-0 items-center gap-3">
            <RoleTag role={user.role} />
            <span className="text-xs text-muted-foreground">
              {roles.find((r) => r.id === user.role?.id)?.description ?? ""}
            </span>
          </div>
          <Select
            value={user.role?.id ?? ""}
            onValueChange={onChangeRole}
            disabled={assignRole.isPending || isSelf}
          >
            <SelectTrigger size="sm" className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {roles.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {isSelf && user.role?.id === "role_admin" ? (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
            <ShieldAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            {m.admin_users_detail_role_self_lock()}
          </p>
        ) : null}
      </DetailSection>

      <DetailSection
        title={m.admin_users_detail_sessions_title()}
        subtitle={
          user.activeSessions === 1
            ? m.admin_users_detail_sessions_subtitle_one()
            : m.admin_users_detail_sessions_subtitle_many({ count: String(user.activeSessions) })
        }
      >
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirm("revoke")}
          disabled={user.activeSessions === 0 || isSelf || revokeSessions.isPending}
        >
          <LogOutIcon aria-hidden="true" />
          {m.admin_users_detail_sessions_revoke()}
        </Button>
      </DetailSection>

      {!isSelf ? (
        <>
          <Separator />
          <DetailSection
            title={m.admin_users_detail_danger_title()}
            subtitle={m.admin_users_detail_danger_subtitle()}
            tone="danger"
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirm("delete")}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <TriangleAlertIcon aria-hidden="true" />
              {m.admin_users_detail_delete_cta()}
            </Button>
          </DetailSection>
        </>
      ) : null}

      <ConfirmDialog
        open={confirm === "delete"}
        title={m.admin_users_detail_confirm_delete_title({ name: user.name })}
        description={m.admin_users_detail_confirm_delete_body({ email: user.email })}
        confirmLabel={m.admin_users_detail_confirm_delete_cta()}
        danger
        pending={deleteUser.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          deleteUser.mutate(user.id, {
            onSuccess: () => {
              setConfirm(null);
              onBack();
            },
          });
        }}
      />
      <ConfirmDialog
        open={confirm === "revoke"}
        title={m.admin_users_detail_confirm_sessions_title()}
        description={m.admin_users_detail_confirm_sessions_body()}
        confirmLabel={m.admin_users_detail_confirm_sessions_cta()}
        pending={revokeSessions.isPending}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          revokeSessions.mutate(user.id, {
            onSuccess: () => setConfirm(null),
          });
        }}
      />
    </div>
  );
}

function IdentityCard({
  user,
  joined,
  isSelf,
}: {
  user: AdminUserDetail;
  joined: string;
  isSelf: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-5">
      <UserAvatar name={user.name} email={user.email} className="size-14" />
      <div className="flex-1 min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-semibold tracking-tight">{user.name}</h2>
          {isSelf ? <Badge variant="outline">{m.admin_users_you_badge()}</Badge> : null}
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">{user.email}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          {m.admin_users_detail_joined()} <span className="text-foreground">{joined}</span> ·{" "}
          {user.activeSessions === 1
            ? m.admin_users_detail_active_session_one()
            : m.admin_users_detail_active_session_many({ count: String(user.activeSessions) })}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        <RoleTag role={user.role} />
      </div>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  tone,
  children,
}: {
  title: string;
  subtitle?: string;
  tone?: "danger";
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3
          className={`text-sm font-semibold tracking-tight ${
            tone === "danger" ? "text-destructive" : "text-foreground"
          }`}
        >
          {title}
        </h3>
        {subtitle ? <p className="max-w-prose text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger,
  pending,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? null : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            {m.admin_users_detail_cancel()}
          </Button>
          <Button
            onClick={onConfirm}
            disabled={pending}
            className={
              danger
                ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
                : undefined
            }
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
