// fallow-ignore-file complexity
import { Suspense, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { trim } from "es-toolkit/string";
import { CheckIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
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
import { Field, FieldDescription, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { UserAvatar } from "@/shared/components/user-avatar";
import { authClient } from "@/shared/lib/auth";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/shared/components/settings-page-header";
import {
  SettingsCard,
  SettingsCardRow,
  settingsKeys,
  useSettingsDirty,
  usePublicConfig,
  useRole,
} from "@/features/settings";

export function SettingsProfileRoute() {
  return (
    <SettingsErrorBoundary>
      <Suspense fallback={<ProfileSkeleton />}>
        <ProfilePage />
      </Suspense>
    </SettingsErrorBoundary>
  );
}

function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="h-4 w-72" />
      </div>
      <Skeleton className="h-72 w-full rounded-2xl" />
      <Skeleton className="h-32 w-full rounded-2xl" />
    </div>
  );
}

interface ProfileViewUser {
  name: string;
  email: string;
  emailVerified: boolean;
  createdAt: string;
}

function ProfilePage() {
  const session = authClient.useSession();
  const publicConfig = usePublicConfig();
  const emailEnabled = publicConfig.data.emailEnabled;
  const sessionUser = session.data?.user;

  if (!sessionUser) return <ProfileSkeleton />;

  const user: ProfileViewUser = {
    name: sessionUser.name,
    email: sessionUser.email,
    emailVerified: Boolean(sessionUser.emailVerified),
    createdAt:
      sessionUser.createdAt instanceof Date
        ? sessionUser.createdAt.toISOString()
        : String(sessionUser.createdAt),
  };

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_profile_title()}
        description={m.settings_profile_description()}
      />

      {emailEnabled && !user.emailVerified ? <VerifyBanner email={user.email} /> : null}

      <IdentityCard user={user} emailEnabled={emailEnabled} />
      <AccountCard user={user} />
    </div>
  );
}

// ─── Identity ───────────────────────────────────────────────────────────────

function IdentityCard({ user, emailEnabled }: { user: ProfileViewUser; emailEnabled: boolean }) {
  return (
    <SettingsCard>
      <SettingsCardRow
        label={m.settings_profile_avatar_label()}
        hint={m.settings_profile_avatar_hint()}
        align="top"
      >
        <div className="flex items-center gap-4">
          <UserAvatar name={user.name} email={user.email} className="size-18" />
          <p className="max-w-65 text-xs text-muted-foreground">
            {m.settings_profile_avatar_hint()}
          </p>
        </div>
      </SettingsCardRow>

      <NameRow currentName={user.name} />

      <EmailRow
        currentEmail={user.email}
        emailVerified={user.emailVerified}
        emailEnabled={emailEnabled}
      />
    </SettingsCard>
  );
}

// ─── Name ───────────────────────────────────────────────────────────────────

export function NameRow({
  currentName,
  onSave,
}: {
  currentName: string;
  /** Optional override used by tests; default path calls Better Auth. */
  onSave?: (next: string) => Promise<void> | void;
}) {
  const qc = useQueryClient();
  const [draft, setDraft] = useState(currentName);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(currentName);
  }, [currentName]);

  const trimmed = trim(draft);
  const dirty = trimmed.length > 0 && trimmed !== currentName;

  const save = async () => {
    if (!dirty) return;
    setSubmitting(true);
    try {
      if (onSave) {
        await onSave(trimmed);
      } else {
        const result = await authClient.updateUser({ name: trimmed });
        if (result.error) throw new Error(result.error.message ?? "Update failed");
      }
      // Better Auth's `useSession` is reactive and refreshes on its own after
      // `updateUser`, so the only React Query data tied to the user identity
      // worth refreshing is the role summary (which inlines the display name
      // server-side in its description payload).
      await qc.invalidateQueries({ queryKey: settingsKeys.role() });
      toast.success(m.settings_profile_toast_name_updated());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : m.settings_profile_toast_name_failed());
    } finally {
      setSubmitting(false);
    }
  };
  const discard = () => setDraft(currentName);

  useSettingsDirty("profile-name", dirty, {
    label: m.settings_profile_dirty_name(),
    onSave: () => void save(),
    onDiscard: discard,
  });

  return (
    <SettingsCardRow
      label={m.settings_profile_name_label()}
      hint={m.settings_profile_name_hint()}
      borderTop
    >
      <div className="flex flex-wrap items-center gap-2">
        <Field className="flex-1 min-w-55">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            data-testid="profile-name"
          />
        </Field>
        <Button
          size="sm"
          disabled={!dirty || submitting}
          onClick={() => void save()}
          data-testid="save-name"
        >
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

export function EmailRow({
  currentEmail,
  emailVerified,
  emailEnabled,
  onCommit,
}: {
  currentEmail: string;
  emailVerified: boolean;
  emailEnabled: boolean;
  /** Optional override used by tests; default path calls Better Auth. */
  onCommit?: (next: string) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(currentEmail);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    setDraft(currentEmail);
  }, [currentEmail]);

  const trimmedDraft = trim(draft);
  const dirty =
    trimmedDraft.length > 0 && trimmedDraft.toLowerCase() !== currentEmail.toLowerCase();

  const submit = () => {
    if (!dirty) return;
    setError(null);
    setConfirmOpen(true);
  };

  const confirm = async () => {
    const next = trimmedDraft;
    setSubmitting(true);
    try {
      if (onCommit) {
        await onCommit(next);
      } else {
        const result = await authClient.changeEmail(
          emailEnabled ? { newEmail: next, callbackURL: "/settings/profile" } : { newEmail: next },
        );
        if (result.error) throw new Error(result.error.message ?? "Email change failed");
      }
      setConfirmOpen(false);
      // Better Auth refreshes the active session reactively; nothing in the
      // React Query cache is keyed on the user's email today, so we skip
      // invalidation here rather than refetch the entire query tree.
      toast.success(
        emailEnabled
          ? m.settings_profile_toast_email_verification_sent()
          : m.settings_profile_toast_email_updated(),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
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
        <Field className="flex-1 min-w-55" data-invalid={error ? true : undefined}>
          <Input
            type="email"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-invalid={error ? true : undefined}
            data-testid="profile-email"
          />
          {error ? <FieldError>{error}</FieldError> : null}
          <FieldDescription>
            <span
              className={cn(
                "inline-flex items-center gap-1.5 text-xs",
                emailVerified ? "text-success" : "text-warning",
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
        target={trimmedDraft}
        submitting={submitting}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void confirm()}
      />
    </SettingsCardRow>
  );
}

function ChangeEmailDialog({
  open,
  emailEnabled,
  target,
  submitting,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  emailEnabled: boolean;
  target: string;
  submitting: boolean;
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
          <Button variant="outline" onClick={onCancel} disabled={submitting}>
            {m.settings_profile_email_dialog_cancel()}
          </Button>
          <Button onClick={onConfirm} disabled={submitting} data-testid="confirm-direct-email">
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

function AccountCard({ user }: { user: ProfileViewUser }) {
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
      <RoleRow />
    </SettingsCard>
  );
}

function RoleRow() {
  const role = useRole().data.role;
  if (!role) return null;
  return (
    <SettingsCardRow
      label={m.settings_profile_role_label()}
      hint={role.description ?? m.settings_profile_role_default_description()}
      borderTop
      align="top"
    >
      <Badge variant="secondary" className="font-medium">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-success" />
        {role.name}
      </Badge>
    </SettingsCardRow>
  );
}

// ─── Verify banner ──────────────────────────────────────────────────────────

const VERIFICATION_COOLDOWN_SECONDS = 60;

export function VerifyBanner({
  email,
  onResend,
}: {
  email: string;
  /** Optional override used by tests; default path calls Better Auth. */
  onResend?: () => Promise<void> | void;
}) {
  const [cooldown, setCooldown] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const resend = async () => {
    setSubmitting(true);
    try {
      if (onResend) {
        await onResend();
      } else {
        const result = await authClient.sendVerificationEmail({ email });
        if (result.error) throw new Error(result.error.message ?? "Send failed");
      }
      setCooldown(VERIFICATION_COOLDOWN_SECONDS);
      toast.success(m.settings_profile_toast_verification_sent());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Alert>
      <TriangleAlertIcon />
      <AlertTitle>{m.settings_profile_verify_banner_title()}</AlertTitle>
      <AlertDescription>{m.settings_profile_verify_banner_body({ email })}</AlertDescription>
      <Button
        variant="outline"
        size="sm"
        disabled={cooldown > 0 || submitting}
        onClick={() => void resend()}
        data-testid="resend-verification"
        className="col-start-2 mt-2 justify-self-start"
      >
        {cooldown > 0
          ? m.settings_profile_verify_resend_cooldown({ seconds: cooldown })
          : m.settings_profile_verify_resend()}
      </Button>
    </Alert>
  );
}
