// fallow-ignore-file complexity
import { useEffect, useMemo, useState } from "react";
import { ChevronLeftIcon, CopyIcon, InfoIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Field, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Separator } from "@/shared/ui/separator";
import { Textarea } from "@/shared/ui/textarea";
import { UserAvatar } from "@/shared/components/user-avatar";

import { ALL_PERMISSION_KEYS, PERMISSION_TREE, type PermissionScope } from "../lib/permission-tree";
import { deleteRoleMock, duplicateRoleMock, saveRoleMock } from "../lib/roles-store";
import type { RoleMember, RoleRecord } from "../lib/types";
import { PermissionGroup } from "./permission-group";
import { RoleGlyph } from "./role-glyph";

interface Props {
  role: RoleRecord;
  members: RoleMember[];
  onBack: () => void;
}

export function RoleDetail({ role, members, onBack }: Props) {
  const [draft, setDraft] = useState<RoleRecord>(role);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => setDraft(role), [role.id, role]);

  const allPerms = draft.permissions === "*";
  const granted = useMemo<ReadonlySet<string>>(
    () => (allPerms ? new Set(ALL_PERMISSION_KEYS) : new Set(draft.permissions as string[])),
    [allPerms, draft.permissions],
  );

  const dirty = useMemo(() => {
    if (allPerms) return false;
    const draftPerms = [...(draft.permissions as string[])].sort();
    const origPerms =
      role.permissions === "*" ? [...ALL_PERMISSION_KEYS].sort() : [...role.permissions].sort();
    return (
      draft.name !== role.name ||
      draft.description !== role.description ||
      JSON.stringify(draftPerms) !== JSON.stringify(origPerms)
    );
  }, [draft, role, allPerms]);

  const togglePerm = (key: string, on: boolean) => {
    if (allPerms) return;
    setDraft((d) => ({
      ...d,
      permissions: on
        ? Array.from(new Set([...(d.permissions as string[]), key]))
        : (d.permissions as string[]).filter((k) => k !== key),
    }));
  };

  const toggleScope = (scope: PermissionScope, on: boolean) => {
    if (allPerms) return;
    const scopeKeys =
      PERMISSION_TREE.find((g) => g.scope === scope)?.permissions.map((p) => p.key) ?? [];
    setDraft((d) => ({
      ...d,
      permissions: on
        ? Array.from(new Set([...(d.permissions as string[]), ...scopeKeys]))
        : (d.permissions as string[]).filter((k) => !scopeKeys.includes(k)),
    }));
  };

  const save = () => {
    saveRoleMock(draft);
    toast.success(m.admin_roles_toast_saved({ name: draft.name }));
  };

  const duplicate = () => {
    const next = duplicateRoleMock(role);
    toast.success(m.admin_roles_toast_created());
    return next;
  };

  const remove = () => {
    deleteRoleMock(role.id);
    toast.success(m.admin_roles_toast_deleted());
    onBack();
  };

  const memberCount = members.length;
  const permCountLabel = allPerms
    ? m.admin_roles_detail_meta_perms_all({ total: String(ALL_PERMISSION_KEYS.length) })
    : m.admin_roles_detail_meta_perms_count({
        count: String((draft.permissions as string[]).length),
        total: String(ALL_PERMISSION_KEYS.length),
      });

  return (
    <div className="flex flex-col gap-6">
      <Button variant="ghost" size="sm" onClick={onBack} className="self-start gap-1.5">
        <ChevronLeftIcon className="size-4" aria-hidden="true" />
        {m.admin_roles_detail_back()}
      </Button>

      <div className="flex flex-wrap items-start gap-4 rounded-xl border border-border bg-card p-5">
        <RoleGlyph roleId={role.id} />
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {role.isSystem ? (
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{role.name}</h2>
              <Badge variant="outline">{m.admin_roles_badge_system()}</Badge>
              {allPerms ? (
                <Badge variant="outline" className="border-primary/40 text-primary">
                  {m.admin_roles_badge_all_perms()}
                </Badge>
              ) : null}
            </div>
          ) : (
            <Field>
              <FieldLabel className="sr-only">Role name</FieldLabel>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                className="h-10 text-lg font-semibold tracking-tight"
              />
            </Field>
          )}
          {role.isSystem ? (
            <p className="text-sm text-muted-foreground">{role.description}</p>
          ) : (
            <Field>
              <FieldLabel className="sr-only">Description</FieldLabel>
              <Textarea
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
                rows={2}
              />
            </Field>
          )}
          <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
            <span>
              {memberCount === 1
                ? m.admin_roles_detail_meta_members_one()
                : m.admin_roles_detail_meta_members_many({ count: String(memberCount) })}
            </span>
            <span aria-hidden="true">·</span>
            <span>{permCountLabel}</span>
          </p>
        </div>
      </div>

      {role.isSystem ? (
        <div className="flex items-start gap-3 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3">
          <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          <p className="text-sm text-muted-foreground">{m.admin_roles_detail_system_notice()}</p>
        </div>
      ) : null}

      <DetailSection
        title={m.admin_roles_detail_permissions_title()}
        subtitle={
          allPerms
            ? m.admin_roles_detail_permissions_subtitle_admin()
            : m.admin_roles_detail_permissions_subtitle_default()
        }
      >
        <div className="flex flex-col gap-3">
          {PERMISSION_TREE.map((group) => (
            <PermissionGroup
              key={group.scope}
              group={group}
              granted={granted}
              readOnly={role.isSystem}
              onTogglePermission={togglePerm}
              onToggleScope={toggleScope}
            />
          ))}
        </div>
      </DetailSection>

      <DetailSection
        title={m.admin_roles_detail_members_section_title({ count: String(memberCount) })}
        subtitle={
          memberCount === 0
            ? m.admin_roles_detail_members_section_empty()
            : m.admin_roles_detail_members_section_subtitle()
        }
      >
        {memberCount > 0 ? (
          <div className="flex flex-wrap gap-2">
            {members.map((u) => (
              <div
                key={u.id}
                className="flex items-center gap-2 rounded-full border border-border bg-card py-1 pr-3 pl-1"
              >
                <UserAvatar name={u.name} email={u.email} className="size-6" />
                <span className="text-xs">{u.name}</span>
              </div>
            ))}
          </div>
        ) : null}
      </DetailSection>

      <Separator />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={duplicate}>
            <CopyIcon aria-hidden="true" />
            {m.admin_roles_detail_duplicate()}
          </Button>
          {!role.isSystem ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDelete(true)}
              className="border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <TriangleAlertIcon aria-hidden="true" />
              {m.admin_roles_detail_delete_cta()}
            </Button>
          ) : null}
        </div>
        {!role.isSystem ? (
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(role)} disabled={!dirty}>
              {m.admin_roles_detail_reset()}
            </Button>
            <Button size="sm" onClick={save} disabled={!dirty}>
              {m.admin_roles_detail_save()}
            </Button>
          </div>
        ) : null}
      </div>

      <Dialog open={confirmDelete} onOpenChange={(next) => (next ? null : setConfirmDelete(false))}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {m.admin_roles_detail_confirm_delete_title({ name: role.name })}
            </DialogTitle>
            <DialogDescription>
              {memberCount === 0
                ? m.admin_roles_detail_confirm_delete_body_empty()
                : memberCount === 1
                  ? m.admin_roles_detail_confirm_delete_body_some_one()
                  : m.admin_roles_detail_confirm_delete_body_some_many({
                      count: String(memberCount),
                    })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              {m.admin_roles_detail_cancel()}
            </Button>
            <Button
              onClick={remove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {m.admin_roles_detail_confirm_delete_cta()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailSection({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {subtitle ? <p className="max-w-prose text-xs text-muted-foreground">{subtitle}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}
