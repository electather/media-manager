import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { UserAvatar } from "@/components/user-avatar";
import { api } from "@/lib/api";
import { authClient } from "@/lib/auth";

export const Route = createFileRoute("/_authenticated/settings/profile")({
  component: ProfileSection,
});

const PUBLIC_CONFIG_QUERY_KEY = ["config", "public"] as const;
const ROLE_QUERY_KEY = ["me", "role"] as const;
const VERIFICATION_COUNTDOWN_SECONDS = 60;

function ProfileSection() {
  const session = authClient.useSession();
  const user = session.data?.user;
  const publicConfigQuery = useQuery({
    queryKey: PUBLIC_CONFIG_QUERY_KEY,
    queryFn: async () => {
      const res = await api.config.public.$get();
      if (!res.ok) throw new Error("failed to load public config");
      return res.json();
    },
    staleTime: Infinity,
  });
  const emailEnabled = publicConfigQuery.data?.emailEnabled ?? false;

  if (!user) {
    return null;
  }

  return (
    <div className="flex flex-col gap-8">
      <PageHeader />
      {emailEnabled && !user.emailVerified ? <VerificationBanner email={user.email} /> : null}
      <AvatarHeader name={user.name} email={user.email} />
      <NameField currentName={user.name} />
      <EmailField currentEmail={user.email} emailEnabled={emailEnabled} />
      <MemberSince createdAt={user.createdAt} />
      <RoleRow />
    </div>
  );
}

function PageHeader() {
  return (
    <div>
      <h2 className="text-base font-medium">Profile</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Your personal information. Initials are generated from your name and shown in other users'
        views where relevant.
      </p>
    </div>
  );
}

function AvatarHeader({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex items-center gap-4">
      <UserAvatar name={name} email={email} size="lg" />
      <div>
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">Avatar generated from your name.</p>
      </div>
    </div>
  );
}

// ─── Name ─────────────────────────────────────────────────────────────────────

export function NameField({ currentName }: { currentName: string }) {
  const [draft, setDraft] = useState(currentName);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(currentName);
  }, [currentName]);

  const dirty = draft.trim().length > 0 && draft !== currentName;

  const mutation = useMutation({
    mutationFn: async (name: string) => {
      const result = await authClient.updateUser({ name });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      toast.success("Name updated.");
      setError(null);
    },
    onError: (err: unknown) => {
      const message = (err as { message?: string } | null)?.message ?? "Could not update name.";
      setError(message);
    },
  });

  return (
    <Field data-invalid={error ? true : undefined} className="max-w-sm">
      <FieldTitle>Name</FieldTitle>
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={error ? true : undefined}
        data-testid="profile-name"
      />
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="mt-1 flex items-center gap-2">
        <Button
          size="sm"
          disabled={!dirty || mutation.isPending}
          onClick={() => mutation.mutate(draft.trim())}
          data-testid="save-name"
        >
          {mutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          Save name
        </Button>
        {!dirty && !mutation.isPending && !error ? (
          <span className="text-xs text-muted-foreground">No changes</span>
        ) : null}
      </div>
    </Field>
  );
}

// ─── Email ────────────────────────────────────────────────────────────────────

export function EmailField({
  currentEmail,
  emailEnabled,
}: {
  currentEmail: string;
  emailEnabled: boolean;
}) {
  const [draft, setDraft] = useState(currentEmail);
  const [error, setError] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [pendingDirectChange, setPendingPasswordConfirm] = useState<string | null>(null);

  useEffect(() => {
    setDraft(currentEmail);
  }, [currentEmail]);

  const dirty =
    draft.trim().length > 0 && draft.trim().toLowerCase() !== currentEmail.toLowerCase();

  const verifiedMutation = useMutation({
    mutationFn: async (newEmail: string) => {
      const result = await authClient.changeEmail({
        newEmail,
        callbackURL: "/settings/profile",
      });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      setConfirmation(currentEmail);
      setError(null);
    },
    onError: (err: unknown) => {
      const message = (err as { message?: string } | null)?.message ?? "Could not change email.";
      setError(message);
    },
  });

  // In disabled-mode the server's `sendChangeEmailConfirmation` hook is
  // unset, so `changeEmail` flips the address immediately. The confirm
  // dialog is a deliberate-action gate, not a password check.
  const directMutation = useMutation({
    mutationFn: async (newEmail: string) => {
      const result = await authClient.changeEmail({ newEmail });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      toast.success("Email updated.");
      setPendingPasswordConfirm(null);
      setError(null);
    },
    onError: (err: unknown) => {
      const message = (err as { message?: string } | null)?.message ?? "Could not change email.";
      setError(message);
    },
  });

  const submit = () => {
    setError(null);
    const trimmed = draft.trim();
    if (emailEnabled) {
      verifiedMutation.mutate(trimmed);
    } else {
      setPendingPasswordConfirm(trimmed);
    }
  };

  if (confirmation) {
    return (
      <Field className="max-w-sm">
        <FieldTitle>Email</FieldTitle>
        <p className="text-sm text-muted-foreground">
          We've sent a confirmation link to{" "}
          <strong className="text-foreground">{confirmation}</strong>. Click it to complete the
          change.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setConfirmation(null)}
          data-testid="cancel-email-confirmation"
        >
          Cancel
        </Button>
      </Field>
    );
  }

  return (
    <Field data-invalid={error ? true : undefined} className="max-w-sm">
      <FieldTitle>Email</FieldTitle>
      <Input
        type="email"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        aria-invalid={error ? true : undefined}
        data-testid="profile-email"
      />
      {emailEnabled ? (
        <FieldDescription>We'll send a verification link to your current address.</FieldDescription>
      ) : (
        <FieldDescription>
          No verification email will be sent — make sure the new address is correct.
        </FieldDescription>
      )}
      {error ? <FieldError>{error}</FieldError> : null}
      <div className="mt-1">
        <Button
          size="sm"
          variant="outline"
          disabled={!dirty || verifiedMutation.isPending || directMutation.isPending}
          onClick={submit}
          data-testid="change-email"
        >
          {verifiedMutation.isPending || directMutation.isPending ? (
            <LoaderCircleIcon className="animate-spin" />
          ) : null}
          Change email
        </Button>
      </div>
      <DirectChangeEmailDialog
        target={pendingDirectChange}
        onCancel={() => setPendingPasswordConfirm(null)}
        onConfirm={() => pendingDirectChange && directMutation.mutate(pendingDirectChange)}
        pending={directMutation.isPending}
      />
    </Field>
  );
}

function DirectChangeEmailDialog({
  target,
  onCancel,
  onConfirm,
  pending,
}: {
  target: string | null;
  onCancel: () => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent showCloseButton={!pending}>
        <DialogHeader>
          <DialogTitle>Confirm email change</DialogTitle>
          <DialogDescription>
            No verification email will be sent. The new address takes effect immediately.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={onConfirm}
            disabled={pending}
            data-testid="confirm-direct-email"
          >
            {pending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Change email to {target}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Member since ─────────────────────────────────────────────────────────────

function MemberSince({ createdAt }: { createdAt: Date | string | number | undefined }) {
  if (!createdAt) return null;
  const date = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const label = date.toLocaleString("en-US", { month: "long", year: "numeric" });
  return (
    <Field className="max-w-sm">
      <FieldTitle>Member since</FieldTitle>
      <p className="text-sm">{label}</p>
    </Field>
  );
}

// ─── Role row ─────────────────────────────────────────────────────────────────

function RoleRow() {
  const roleQuery = useQuery({
    queryKey: ROLE_QUERY_KEY,
    queryFn: async () => {
      const res = await api.me.role.$get();
      if (!res.ok) throw new Error("failed to load role");
      return res.json();
    },
  });

  const role = roleQuery.data?.role;
  if (!role) return null;

  return (
    <Field className="max-w-sm">
      <FieldTitle>Role</FieldTitle>
      <div className="flex flex-col gap-1">
        <Badge variant="secondary" className="w-fit">
          {role.name}
        </Badge>
        {role.description ? (
          <p className="text-xs text-muted-foreground">{role.description}</p>
        ) : null}
      </div>
    </Field>
  );
}

// ─── Verification banner ──────────────────────────────────────────────────────

export function VerificationBanner({ email }: { email: string }) {
  const [dismissed, setDismissed] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const id = window.setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [cooldown]);

  const resend = useMutation({
    mutationFn: async () => {
      const result = await authClient.sendVerificationEmail({ email });
      if (result.error) throw result.error;
    },
    onSuccess: () => {
      toast.success("Verification email sent.");
      setCooldown(VERIFICATION_COUNTDOWN_SECONDS);
    },
    onError: (err: unknown) => {
      const message = (err as { message?: string } | null)?.message ?? "Could not resend.";
      toast.error(message);
    },
  });

  if (dismissed) return null;

  return (
    <div
      role="status"
      className="flex max-w-3xl items-center justify-between gap-4 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-3 dark:border-amber-700/60 dark:bg-amber-950/40"
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium">Verify your email address to secure your account.</p>
        <p className="text-xs text-muted-foreground">
          We sent a verification link to <strong className="text-foreground">{email}</strong>.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={cooldown > 0 || resend.isPending}
          onClick={() => resend.mutate()}
          data-testid="resend-verification"
        >
          {resend.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
          {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend verification email"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss verification banner"
          data-testid="dismiss-verification"
        >
          <CheckIcon className="size-3" />
        </Button>
      </div>
    </div>
  );
}
