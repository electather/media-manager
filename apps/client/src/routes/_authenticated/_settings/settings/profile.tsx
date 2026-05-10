// fallow-ignore-file complexity
import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Field, FieldDescription } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { useSettingsDirty } from "@/app/settings-dirty-context";
import { InitialsAvatar, SettingsCard, SettingsCardRow } from "@/features/settings";
import { MOCK_ROLE, MOCK_USER, type MockUser } from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/profile")({
  component: ProfileRoute,
});

function ProfileRoute() {
  return (
    <SettingsErrorBoundary>
      <ProfilePage />
    </SettingsErrorBoundary>
  );
}

function ProfilePage() {
  const [user, setUser] = useState<MockUser>(MOCK_USER);
  const emailEnabled = true;

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_profile_title()}
        description={m.settings_profile_description()}
      />

      {emailEnabled && !user.emailVerified ? <VerifyBanner email={user.email} /> : null}

      <IdentityCard user={user} setUser={setUser} emailEnabled={emailEnabled} />
      <AccountCard user={user} />
    </div>
  );
}

// ─── Identity ───────────────────────────────────────────────────────────────

function IdentityCard({
  user,
  setUser,
  emailEnabled,
}: {
  user: MockUser;
  setUser: (updater: (prev: MockUser) => MockUser) => void;
  emailEnabled: boolean;
}) {
  return (
    <SettingsCard>
      <SettingsCardRow
        label={m.settings_profile_avatar_label()}
        hint={m.settings_profile_avatar_hint()}
        align="top"
      >
        <div className="flex items-center gap-4">
          <InitialsAvatar name={user.name} />
          <p className="max-w-[260px] text-xs text-muted-foreground">
            {m.settings_profile_avatar_hint()}
          </p>
        </div>
      </SettingsCardRow>

      <NameRow currentName={user.name} onSave={(next) => setUser((u) => ({ ...u, name: next }))} />

      <EmailRow
        currentEmail={user.email}
        emailVerified={user.emailVerified}
        emailEnabled={emailEnabled}
        onCommit={(next) => setUser((u) => ({ ...u, email: next, emailVerified: false }))}
      />
    </SettingsCard>
  );
}

// ─── Name ───────────────────────────────────────────────────────────────────

function NameRow({ currentName, onSave }: { currentName: string; onSave: (next: string) => void }) {
  const [draft, setDraft] = useState(currentName);

  useEffect(() => {
    setDraft(currentName);
  }, [currentName]);

  const trimmed = draft.trim();
  const dirty = trimmed.length > 0 && trimmed !== currentName;

  const save = () => {
    if (!dirty) return;
    onSave(trimmed);
    toast.success(m.settings_profile_toast_name_updated());
  };
  const discard = () => setDraft(currentName);

  useSettingsDirty("profile-name", dirty, {
    label: m.settings_profile_dirty_name(),
    onSave: save,
    onDiscard: discard,
  });

  return (
    <SettingsCardRow
      label={m.settings_profile_name_label()}
      hint={m.settings_profile_name_hint()}
      borderTop
    >
      <div className="flex flex-wrap items-center gap-2">
        <Field className="flex-1 min-w-[220px]">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="profile-name"
          />
        </Field>
        <Button size="sm" disabled={!dirty} onClick={save} data-testid="save-name">
          {m.settings_profile_name_save()}
        </Button>
      </div>
      {!dirty ? (
        <p className="mt-2 text-xs text-muted-foreground">{m.settings_profile_name_no_changes()}</p>
      ) : null}
    </SettingsCardRow>
  );
}

// ─── Email ──────────────────────────────────────────────────────────────────

function EmailRow({
  currentEmail,
  emailVerified,
  emailEnabled,
  onCommit,
}: {
  currentEmail: string;
  emailVerified: boolean;
  emailEnabled: boolean;
  onCommit: (next: string) => void;
}) {
  const [draft, setDraft] = useState(currentEmail);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    setDraft(currentEmail);
  }, [currentEmail]);

  const dirty =
    draft.trim().length > 0 && draft.trim().toLowerCase() !== currentEmail.toLowerCase();

  const submit = () => {
    if (!dirty) return;
    setConfirmOpen(true);
  };

  const confirm = () => {
    onCommit(draft.trim());
    setConfirmOpen(false);
    if (emailEnabled) {
      toast.success(m.settings_profile_toast_email_verification_sent());
    } else {
      toast.success(m.settings_profile_toast_email_updated());
    }
  };

  return (
    <SettingsCardRow
      label={m.settings_profile_email_label()}
      hint={
        emailEnabled
          ? m.settings_profile_email_hint_verified()
          : m.settings_profile_email_hint_unverified()
      }
      borderTop
      align="top"
    >
      <div className="flex flex-wrap items-start gap-2">
        <Field className="flex-1 min-w-[220px]">
          <Input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="profile-email"
          />
          <FieldDescription>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                emailVerified ? "text-success" : "text-amber-500 dark:text-amber-400",
              )}
            >
              {emailVerified ? (
                <CheckIcon className="size-3.5" aria-hidden="true" />
              ) : (
                <TriangleAlertIcon className="size-3.5" aria-hidden="true" />
              )}
              {emailVerified
                ? m.settings_profile_email_verified()
                : m.settings_profile_email_unverified()}
            </span>
          </FieldDescription>
        </Field>
        <Button
          variant="outline"
          size="sm"
          disabled={!dirty}
          onClick={submit}
          data-testid="change-email"
        >
          {m.settings_profile_email_change()}
        </Button>
      </div>

      <ChangeEmailDialog
        open={confirmOpen}
        emailEnabled={emailEnabled}
        target={draft.trim()}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirm}
      />
    </SettingsCardRow>
  );
}

function ChangeEmailDialog({
  open,
  emailEnabled,
  target,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  emailEnabled: boolean;
  target: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onCancel())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {emailEnabled
              ? m.settings_profile_email_dialog_verified_title()
              : m.settings_profile_email_dialog_unverified_title()}
          </DialogTitle>
          <DialogDescription>
            {emailEnabled
              ? m.settings_profile_email_dialog_verified_body({ email: target })
              : m.settings_profile_email_dialog_unverified_body({ email: target })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {m.settings_profile_email_dialog_cancel()}
          </Button>
          <Button onClick={onConfirm} data-testid="confirm-direct-email">
            {emailEnabled
              ? m.settings_profile_email_dialog_send()
              : m.settings_profile_email_dialog_change()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Account ────────────────────────────────────────────────────────────────

function AccountCard({ user }: { user: MockUser }) {
  const memberSince = useMemo(() => {
    try {
      return new Date(user.createdAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
    } catch {
      return "—";
    }
  }, [user.createdAt]);

  return (
    <SettingsCard>
      <SettingsCardRow
        label={m.settings_profile_member_since_label()}
        hint={m.settings_profile_member_since_hint()}
      >
        <div className="text-sm tabular-nums text-foreground">{memberSince}</div>
      </SettingsCardRow>
      <SettingsCardRow
        label={m.settings_profile_role_label()}
        hint={m.settings_profile_role_default_description()}
        borderTop
        align="top"
      >
        <Badge variant="secondary" className="font-medium">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
          {MOCK_ROLE.name}
        </Badge>
      </SettingsCardRow>
    </SettingsCard>
  );
}

// ─── Verify banner ──────────────────────────────────────────────────────────

const VERIFICATION_COOLDOWN_SECONDS = 60;

function VerifyBanner({ email }: { email: string }) {
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const resend = () => {
    setCooldown(VERIFICATION_COOLDOWN_SECONDS);
    toast.success(m.settings_profile_toast_verification_sent());
  };

  return (
    <div
      role="status"
      className="flex flex-wrap items-start justify-between gap-4 rounded-xl border border-amber-300/40 bg-amber-50 px-4 py-3 dark:border-amber-700/50 dark:bg-amber-950/30"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <div
          className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-amber-200/40 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          aria-hidden="true"
        >
          <TriangleAlertIcon className="size-3.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
            {m.settings_profile_verify_banner_title()}
          </p>
          <p className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-200/80">
            {m.settings_profile_verify_banner_body({ email })}
          </p>
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        disabled={cooldown > 0}
        onClick={resend}
        data-testid="resend-verification"
        className="shrink-0 border-amber-300/60 bg-transparent text-amber-900 hover:bg-amber-100/40 dark:border-amber-700/60 dark:text-amber-100 dark:hover:bg-amber-500/10"
      >
        {cooldown > 0
          ? m.settings_profile_verify_resend_cooldown({ seconds: cooldown })
          : m.settings_profile_verify_resend()}
      </Button>
    </div>
  );
}
