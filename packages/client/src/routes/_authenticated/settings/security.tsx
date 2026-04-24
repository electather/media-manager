import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LoaderCircleIcon } from "lucide-react";
import { toast } from "sonner";

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
import { Skeleton } from "@/components/ui/skeleton";
import { SessionRow, type SessionListItem } from "@/components/settings/session-row";
import { authClient } from "@/lib/auth";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/_authenticated/settings/security")({
  component: SecuritySection,
});

const MIN_PASSWORD_LENGTH = 12;
const SESSIONS_QUERY_KEY = ["security", "sessions"] as const;

// ─── Page ─────────────────────────────────────────────────────────────────────

function SecuritySection() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h2 className="text-base font-medium">Security</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your password and active sessions.
        </p>
      </div>

      <ChangePasswordCard />
      <ActiveSessionsCard />
    </div>
  );
}

// ─── Change password ──────────────────────────────────────────────────────────

interface PasswordFieldErrors {
  currentPassword?: string;
  newPassword?: string;
  confirmPassword?: string;
}

export function ChangePasswordCard() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [errors, setErrors] = useState<PasswordFieldErrors>({});

  const reset = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setErrors({});
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.changePassword({
        currentPassword,
        newPassword,
        revokeOtherSessions: true,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated — other sessions signed out.");
      reset();
      setOpen(false);
      // revokeOtherSessions: true kills other sessions server-side; refetch the list.
      void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
    },
    onError: (err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      const code = (err as { code?: string } | null)?.code;
      const message = (err as { message?: string } | null)?.message ?? "Could not update password.";

      // Better Auth tags wrong-current-password as `code: "INVALID_PASSWORD"`
      // (status 400). The OpenAPI doc also lists 401. Match the explicit code
      // first; fall back to 401 or recognisable message text only when the
      // server didn't supply a code, so other 400s (rate limit, malformed
      // body, policy violation) don't get mislabelled.
      const lower = message.toLowerCase();
      const looksWrongCurrent =
        code === "INVALID_PASSWORD" ||
        status === 401 ||
        lower.includes("incorrect") ||
        lower.includes("invalid password") ||
        lower.includes("current password");

      if (looksWrongCurrent) {
        setErrors({ currentPassword: "That password is incorrect." });
      } else {
        // Server-side policy violations land under new password per spec.
        setErrors({ newPassword: message });
      }
    },
  });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next: PasswordFieldErrors = {};
    if (!currentPassword) next.currentPassword = "Enter your current password.";
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      next.newPassword = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirmPassword !== newPassword) {
      next.confirmPassword = "Passwords do not match.";
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    mutation.mutate();
  };

  if (!open) {
    return (
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">Password</h3>
          <p className="text-xs text-muted-foreground">
            Change your password. Other sessions will be signed out.
          </p>
        </div>
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            data-testid="open-change-password"
          >
            Change password
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Change password</h3>
      </div>
      <form
        onSubmit={submit}
        className="flex max-w-sm flex-col gap-4 rounded-xl border border-border p-4"
        noValidate
      >
        <Field data-invalid={errors.currentPassword ? true : undefined}>
          <FieldTitle>Current password</FieldTitle>
          <Input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            aria-invalid={errors.currentPassword ? true : undefined}
            data-testid="current-password"
          />
          {errors.currentPassword ? <FieldError>{errors.currentPassword}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.newPassword ? true : undefined}>
          <FieldTitle>New password</FieldTitle>
          <Input
            type="password"
            autoComplete="new-password"
            placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            aria-invalid={errors.newPassword ? true : undefined}
            data-testid="new-password"
          />
          <FieldDescription>Use at least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
          {errors.newPassword ? <FieldError>{errors.newPassword}</FieldError> : null}
        </Field>

        <Field data-invalid={errors.confirmPassword ? true : undefined}>
          <FieldTitle>Confirm new password</FieldTitle>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            aria-invalid={errors.confirmPassword ? true : undefined}
            data-testid="confirm-password"
          />
          {errors.confirmPassword ? <FieldError>{errors.confirmPassword}</FieldError> : null}
        </Field>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              reset();
              setOpen(false);
            }}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={mutation.isPending} data-testid="save-password">
            {mutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
            Save password
          </Button>
        </div>
      </form>
    </section>
  );
}

// ─── Active sessions ──────────────────────────────────────────────────────────

export function ActiveSessionsCard() {
  const qc = useQueryClient();
  const { data: currentSession } = authClient.useSession();
  const currentSessionId = currentSession?.session?.id ?? null;

  const sessionsQuery = useQuery({
    queryKey: SESSIONS_QUERY_KEY,
    queryFn: async (): Promise<SessionListItem[]> => {
      const { data, error } = await authClient.listSessions();
      if (error) throw new Error(error.message ?? "Failed to load active sessions.");
      return (data ?? []) as SessionListItem[];
    },
  });

  const sessions = useMemo(() => {
    if (!sessionsQuery.data) return [] as SessionListItem[];
    // Sort by updatedAt desc per spec.
    return [...sessionsQuery.data].sort((a, b) => {
      const ta = new Date(a.updatedAt).getTime();
      const tb = new Date(b.updatedAt).getTime();
      return tb - ta;
    });
  }, [sessionsQuery.data]);

  const otherSessionCount = sessions.filter((s) => s.id !== currentSessionId).length;

  // ── revoke-one ───────────────────────────────────────────────────────────────
  const [confirmRevoke, setConfirmRevoke] = useState<SessionListItem | null>(null);

  const revokeOneMutation = useMutation({
    mutationFn: async (token: string) => {
      const { error } = await authClient.revokeSession({ token });
      if (error) throw new Error(error.message ?? "Failed to revoke session.");
    },
    onSuccess: (_data, token) => {
      // Remove the row optimistically; refetch will confirm.
      qc.setQueryData<SessionListItem[]>(SESSIONS_QUERY_KEY, (prev) =>
        prev ? prev.filter((s) => s.token !== token) : prev,
      );
      void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      toast.success("Session revoked.");
      setConfirmRevoke(null);
    },
    onError: (err: unknown) => {
      toast.error((err as { message?: string } | null)?.message ?? "Failed to revoke session.");
    },
  });

  // ── sign-out-everywhere ──────────────────────────────────────────────────────
  const [confirmSignOutAll, setConfirmSignOutAll] = useState(false);

  const revokeOthersMutation = useMutation({
    mutationFn: async () => {
      const { error } = await authClient.revokeOtherSessions();
      if (error) throw new Error(error.message ?? "Failed to sign out other sessions.");
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
      toast.success("Signed out of other sessions.");
      setConfirmSignOutAll(false);
    },
    onError: (err: unknown) => {
      toast.error(
        (err as { message?: string } | null)?.message ?? "Could not sign out everywhere.",
      );
    },
  });

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h3 className="text-sm font-medium">Active sessions</h3>
        <p className="text-xs text-muted-foreground">
          Devices currently signed in to your account.
        </p>
      </div>

      <div className="flex flex-col gap-2" data-testid="sessions-list">
        {sessionsQuery.isPending ? (
          <>
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </>
        ) : sessionsQuery.isError ? (
          <p className="text-sm text-destructive" role="alert">
            Could not load active sessions.{" "}
            <button
              type="button"
              className="underline underline-offset-2 hover:text-foreground"
              onClick={() => sessionsQuery.refetch()}
            >
              Retry
            </button>
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active sessions found.</p>
        ) : (
          sessions.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              isCurrent={session.id === currentSessionId}
              onRevoke={() => setConfirmRevoke(session)}
              pending={revokeOneMutation.isPending && revokeOneMutation.variables === session.token}
            />
          ))
        )}
      </div>

      {otherSessionCount > 0 ? (
        <div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setConfirmSignOutAll(true)}
            data-testid="sign-out-everywhere"
          >
            Sign out everywhere else
          </Button>
        </div>
      ) : null}

      {/* Revoke-one confirmation dialog */}
      <Dialog
        open={confirmRevoke !== null}
        onOpenChange={(open) => {
          if (!open && !revokeOneMutation.isPending) setConfirmRevoke(null);
        }}
      >
        <DialogContent showCloseButton={!revokeOneMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Revoke this session?</DialogTitle>
            <DialogDescription>
              The device using this session will be signed out immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmRevoke(null)}
              disabled={revokeOneMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => confirmRevoke && revokeOneMutation.mutate(confirmRevoke.token)}
              disabled={revokeOneMutation.isPending}
              data-testid="confirm-revoke"
            >
              {revokeOneMutation.isPending ? <LoaderCircleIcon className="animate-spin" /> : null}
              Revoke session
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign-out-everywhere confirmation dialog */}
      <Dialog
        open={confirmSignOutAll}
        onOpenChange={(open) => {
          if (!open && !revokeOthersMutation.isPending) setConfirmSignOutAll(false);
        }}
      >
        <DialogContent showCloseButton={!revokeOthersMutation.isPending}>
          <DialogHeader>
            <DialogTitle>Sign out everywhere else?</DialogTitle>
            <DialogDescription>
              You&rsquo;ll remain signed in on this device. All other sessions will end.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmSignOutAll(false)}
              disabled={revokeOthersMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => revokeOthersMutation.mutate()}
              disabled={revokeOthersMutation.isPending}
              data-testid="confirm-sign-out-everywhere"
            >
              {revokeOthersMutation.isPending ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : null}
              Sign out everywhere
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
