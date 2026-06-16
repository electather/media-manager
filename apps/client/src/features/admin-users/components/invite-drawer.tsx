// fallow-ignore-file complexity
import { useEffect, useRef, useState } from "react";
import { CheckCircle2Icon, InfoIcon, LinkIcon, PlusIcon } from "lucide-react";
import { toast } from "sonner";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Field, FieldDescription, FieldLabel } from "@/shared/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/shared/ui/sheet";

import { useCreateInvite } from "../hooks/use-create-invite";
import {
  ADMIN_USER_ROLE_IDS,
  isAdminUserRoleId,
  type AdminUserRoleId,
  type AdminInvite,
} from "../lib/types";
import { RoleTag } from "./role-tag";

interface Props {
  open: boolean;
  onClose: () => void;
}

const DAY = 24 * 60 * 60 * 1000;

export function InviteDrawer({ open, onClose }: Props) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? null : onClose())}>
      <SheetContent side="right" className="w-full gap-0 sm:max-w-xl">
        <SheetHeader className="border-b border-border">
          <SheetTitle>{m.admin_users_invite_drawer_title()}</SheetTitle>
          <SheetDescription>{m.admin_users_invite_drawer_subtitle()}</SheetDescription>
        </SheetHeader>
        <InviteDrawerBody open={open} onClose={onClose} />
      </SheetContent>
    </Sheet>
  );
}

function InviteDrawerBody({ open, onClose }: Props) {
  const [roleId, setRoleId] = useState<AdminUserRoleId>("role_member");
  const [expiresInDays, setExpiresInDays] = useState<string>("7");
  const [maxUses, setMaxUses] = useState<string>("5");
  const [generated, setGenerated] = useState<AdminInvite | null>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);
  const createInvite = useCreateInvite();

  useEffect(() => {
    if (open) return;
    const t = window.setTimeout(() => {
      setRoleId("role_member");
      setExpiresInDays("7");
      setMaxUses("5");
      setGenerated(null);
    }, 200);
    return () => window.clearTimeout(t);
  }, [open]);

  const role = {
    id: roleId,
    name: m.admin_users_role_name({ role: roleId }),
    description: m.admin_users_role_description({ role: roleId }),
  };
  const expiresAt = Date.now() + Number(expiresInDays) * DAY;

  const generateLink = () => {
    createInvite.mutate(
      { roleId, expiresAt, maxUses },
      {
        onSuccess: (dto) => {
          setGenerated(dto);
        },
      },
    );
  };

  const copyLink = async () => {
    if (!generated) return;
    try {
      await navigator.clipboard.writeText(generated.url);
      linkInputRef.current?.select();
      toast.success(m.admin_users_invite_toast_copied());
    } catch {
      // Clipboard API may be unavailable in insecure contexts; silently ignore.
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {generated ? (
          <LinkGeneratedView
            generated={generated}
            inputRef={linkInputRef}
            onCopy={() => void copyLink()}
            onReset={() => setGenerated(null)}
          />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-2 gap-3">
              <RoleField roleId={roleId} onChange={setRoleId} />
              <ExpiresField value={expiresInDays} onChange={setExpiresInDays} includeQuarterly />
            </div>
            <Field>
              <FieldLabel>{m.admin_users_invite_max_uses_label()}</FieldLabel>
              <Select value={maxUses} onValueChange={(v) => setMaxUses(v ?? "")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">{m.admin_users_invite_uses_1()}</SelectItem>
                  <SelectItem value="5">{m.admin_users_invite_uses_5()}</SelectItem>
                  <SelectItem value="10">{m.admin_users_invite_uses_10()}</SelectItem>
                  <SelectItem value="25">{m.admin_users_invite_uses_25()}</SelectItem>
                  <SelectItem value="0">{m.admin_users_invite_uses_unlimited()}</SelectItem>
                </SelectContent>
              </Select>
              <FieldDescription>{m.admin_users_invite_max_uses_hint()}</FieldDescription>
            </Field>
            <RoleHint role={role} headingId="invite-link-hint" />
          </div>
        )}
      </div>

      <SheetFooter className="border-t border-border">
        <Button variant="outline" onClick={onClose}>
          {generated ? m.admin_users_invite_done() : m.admin_users_invite_cancel()}
        </Button>
        {!generated ? (
          <Button onClick={generateLink} disabled={createInvite.isPending}>
            <LinkIcon className="size-3.5" aria-hidden="true" />
            {m.admin_users_invite_generate()}
          </Button>
        ) : null}
      </SheetFooter>
    </div>
  );
}

function RoleField({
  roleId,
  onChange,
}: {
  roleId: AdminUserRoleId;
  onChange: (v: AdminUserRoleId) => void;
}) {
  return (
    <Field>
      <FieldLabel>{m.admin_users_invite_role_label()}</FieldLabel>
      <Select value={roleId} onValueChange={(v) => isAdminUserRoleId(v) && onChange(v)}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ADMIN_USER_ROLE_IDS.map((id) => (
            <SelectItem key={id} value={id}>
              {m.admin_users_role_name({ role: id })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function ExpiresField({
  value,
  onChange,
  includeQuarterly,
}: {
  value: string;
  onChange: (v: string) => void;
  includeQuarterly?: boolean;
}) {
  return (
    <Field>
      <FieldLabel>{m.admin_users_invite_expires_label()}</FieldLabel>
      <Select value={value} onValueChange={(v) => onChange(v ?? "")}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="1">{m.admin_users_invite_expires_1d()}</SelectItem>
          <SelectItem value="7">{m.admin_users_invite_expires_7d()}</SelectItem>
          <SelectItem value="14">{m.admin_users_invite_expires_14d()}</SelectItem>
          <SelectItem value="30">{m.admin_users_invite_expires_30d()}</SelectItem>
          {includeQuarterly ? (
            <SelectItem value="90">{m.admin_users_invite_expires_90d()}</SelectItem>
          ) : null}
        </SelectContent>
      </Select>
    </Field>
  );
}

function RoleHint({
  role,
  headingId,
}: {
  role: { id: string; name: string; description: string };
  headingId: string;
}) {
  return (
    <div
      className="flex items-start gap-3 rounded-lg border border-border bg-muted/40 p-3"
      aria-describedby={headingId}
    >
      <InfoIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <p id={headingId} className="text-xs text-muted-foreground">
          {m.admin_users_invite_role_link_hint()}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <RoleTag role={role} />
          <span className="text-xs text-muted-foreground">{role.description}</span>
        </div>
      </div>
    </div>
  );
}

function LinkGeneratedView({
  generated,
  inputRef,
  onCopy,
  onReset,
}: {
  generated: AdminInvite;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onCopy: () => void;
  onReset: () => void;
}) {
  const usesText =
    generated.maxUses === 0
      ? m.admin_users_invite_uses_unlimited()
      : generated.maxUses === 1
        ? m.admin_users_invite_uses_1()
        : m.admin_users_invite_uses_progress({ used: "0", max: String(generated.maxUses) });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-lg border border-success/40 bg-success/10 p-3">
        <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-success">
            {m.admin_users_invite_link_created_title()}
          </p>
          <p className="text-xs text-muted-foreground">
            {new Date(generated.expiresAt).toLocaleString()} · {usesText}
          </p>
        </div>
      </div>
      <Field>
        <FieldLabel>{m.admin_users_invite_link_share_label()}</FieldLabel>
        <div className="flex items-center gap-2">
          <Input ref={inputRef} readOnly value={generated.url} className="font-mono text-xs" />
          <Button variant="outline" size="sm" onClick={onCopy}>
            {m.admin_users_invite_copy()}
          </Button>
        </div>
      </Field>
      <Button variant="outline" onClick={onReset} className="self-start">
        <PlusIcon className="size-3.5" aria-hidden="true" />
        {m.admin_users_invite_generate_another()}
      </Button>
    </div>
  );
}
