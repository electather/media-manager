// fallow-ignore-file complexity
import { Suspense, useMemo, useState } from "react";
import { CheckIcon, EyeIcon, EyeOffIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { PASSWORD_MIN_LENGTH } from "@nama/shared/auth";

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
import { Field, FieldError, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Skeleton } from "@/shared/ui/skeleton";
import { NameGlyph } from "@/shared/components/name-glyph";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { authClient } from "@/shared/lib/auth";
import { relativeTime } from "@/shared/lib/time-format";
import { parseUserAgent } from "@/shared/lib/user-agent";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/shared/components/settings-page-header";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { settingsSecurityKeys } from "../lib/query-keys";
import {
  useRevokeOtherSessions,
  useRevokeSession,
  useSessions,
  type AuthSession,
} from "../hooks/use-sessions";

interface DisplaySession extends AuthSession {
  current: boolean;
}

export function SettingsSecurityRoute() {
  return (
    <SettingsErrorBoundary>
      <SecurityPage />
    </SettingsErrorBoundary>
  );
}

function SecurityPage() {
  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_security_title()}
        description={m.settings_security_description()}
      />
      <ChangePasswordCard />
      <SettingsErrorBoundary resetQueryKey={settingsSecurityKeys.sessions()}>
        <Suspense fallback={<Skeleton className="h-48 w-full rounded-2xl" />}>
          <SessionsSection />
        </Suspense>
      </SettingsErrorBoundary>
    </div>
  );
}

function SessionsSection() {
  const sessions = useSessions();
  const session = authClient.useSession();
  const currentSessionId = session.data?.session.id ?? null;

  const list: DisplaySession[] = useMemo(
    () => sessions.data.map((s) => ({ ...s, current: s.id === currentSessionId })),
    [sessions.data, currentSessionId],
  );

  if (!session.data) return <Skeleton className="h-48 w-full rounded-2xl" />;

  return <ActiveSessionsCard sessions={list} />;
}

// ─── Change password ────────────────────────────────────────────────────────

// Single source of truth: the new-password minimum lives in @nama/shared/auth.
const MIN_PASSWORD_LENGTH = PASSWORD_MIN_LENGTH;

function PasswordChangeForm({
  current,
  next,
  confirm,
  setCurrent,
  setNext,
  setConfirm,
  tooShort,
  mismatch,
  canSubmit,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: {
  current: string;
  next: string;
  confirm: string;
  setCurrent: (v: string) => void;
  setNext: (v: string) => void;
  setConfirm: (v: string) => void;
  tooShort: boolean;
  mismatch: boolean;
  canSubmit: boolean;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 p-5 sm:p-6">
      <Field data-invalid={serverError ? true : undefined}>
        <FieldTitle>{m.settings_security_password_current()}</FieldTitle>
        <PasswordInput
          value={current}
          onChange={setCurrent}
          autoComplete="current-password"
          placeholder={m.settings_security_password_placeholder()}
          ariaInvalid={!!serverError}
          data-testid="current-password"
        />
        {serverError ? <FieldError>{serverError}</FieldError> : null}
      </Field>
      <Field data-invalid={tooShort ? true : undefined}>
        <FieldTitle>{m.settings_security_password_new()}</FieldTitle>
        <PasswordInput
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          placeholder={m.settings_security_password_new_placeholder()}
          ariaInvalid={tooShort}
          data-testid="new-password"
        />
        <PasswordMeter value={next} />
        {tooShort ? <FieldError>{m.settings_security_password_too_short()}</FieldError> : null}
      </Field>
      <Field data-invalid={mismatch ? true : undefined}>
        <FieldTitle>{m.settings_security_password_confirm()}</FieldTitle>
        <PasswordInput
          value={confirm}
          onChange={setConfirm}
          autoComplete="new-password"
          placeholder={m.settings_security_password_confirm_placeholder()}
          ariaInvalid={mismatch}
          data-testid="confirm-password"
        />
        {mismatch ? <FieldError>{m.settings_security_password_mismatch()}</FieldError> : null}
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          {m.settings_security_password_cancel()}
        </Button>
        <Button type="submit" size="sm" disabled={!canSubmit} data-testid="submit-password">
          {submitting
            ? m.settings_security_password_submitting()
            : m.settings_security_password_submit()}
        </Button>
      </div>
    </form>
  );
}

export function ChangePasswordCard({
  onChangePassword,
}: {
  /** Optional override used by tests; default path calls Better Auth. */
  onChangePassword?: (input: { currentPassword: string; newPassword: string }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next && !submitting;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setServerError(null);
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setServerError(null);
    try {
      if (onChangePassword) {
        await onChangePassword({ currentPassword: current, newPassword: next });
      } else {
        const result = await authClient.changePassword({
          currentPassword: current,
          newPassword: next,
          revokeOtherSessions: true,
        });
        if (result.error) {
          if (result.error.status === 401) {
            setServerError(m.settings_security_password_wrong());
            return;
          }
          throw new Error(result.error.message ?? "Password change failed");
        }
      }
      reset();
      toast.success(m.settings_security_toast_password_updated());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_security_password_title()}
        description={m.settings_security_password_description()}
        action={
          !open ? (
            <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
              {m.settings_security_password_change()}
            </Button>
          ) : (
            <Button variant="ghost" size="sm" onClick={reset}>
              <XIcon className="size-3.5" aria-hidden="true" />
              {m.settings_security_password_cancel()}
            </Button>
          )
        }
      />
      {open ? (
        <PasswordChangeForm
          current={current}
          next={next}
          confirm={confirm}
          setCurrent={(v) => {
            setCurrent(v);
            // Clear the "wrong password" server error as soon as the user
            // edits the current-password field, so the red banner does not
            // outlast the input that triggered it.
            if (serverError) setServerError(null);
          }}
          setNext={setNext}
          setConfirm={setConfirm}
          tooShort={tooShort}
          mismatch={mismatch}
          canSubmit={canSubmit}
          submitting={submitting}
          serverError={serverError}
          onSubmit={(e) => void submit(e)}
          onCancel={reset}
        />
      ) : null}
    </SettingsCard>
  );
}

interface PasswordInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  ariaInvalid?: boolean;
  "data-testid"?: string;
}

function PasswordInput(props: PasswordInputProps) {
  const [shown, setShown] = useState(false);
  const { value, onChange, ...rest } = props;
  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={rest.ariaInvalid ? true : undefined}
        autoComplete={rest.autoComplete}
        placeholder={rest.placeholder}
        data-testid={rest["data-testid"]}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={
          shown ? m.settings_security_password_hide() : m.settings_security_password_show()
        }
        className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}

function passwordScore(pw: string): number {
  if (!pw) return 0;
  let s = 0;
  if (pw.length >= 8) s += 1;
  if (pw.length >= 12) s += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s += 1;
  if (/\d/.test(pw)) s += 1;
  if (/[^A-Za-z0-9]/.test(pw)) s += 1;
  return Math.min(4, s);
}

function PasswordMeter({ value }: { value: string }) {
  const score = passwordScore(value);
  const labels = [
    m.settings_security_password_strength_too_short(),
    m.settings_security_password_strength_weak(),
    m.settings_security_password_strength_fair(),
    m.settings_security_password_strength_good(),
    m.settings_security_password_strength_strong(),
  ];
  const tones = ["bg-muted", "bg-destructive", "bg-amber-400", "bg-success", "bg-success"];
  return (
    <div className="mt-2 flex items-center gap-2.5">
      <div className="flex flex-1 gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < score ? tones[score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <span className="min-w-16 text-right text-xs tabular-nums text-muted-foreground">
        {value ? labels[score] : ""}
      </span>
    </div>
  );
}

// ─── Active sessions ────────────────────────────────────────────────────────

function RevokeSessionDialog({
  session,
  onClose,
  onConfirm,
}: {
  session: DisplaySession | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={!!session}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_security_revoke_dialog_title()}</DialogTitle>
          <DialogDescription>
            {session
              ? m.settings_security_revoke_dialog_body({
                  device: parseUserAgent(session.userAgent ?? null).label,
                })
              : null}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_security_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke">
            {m.settings_security_revoke_dialog_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeAllSessionsDialog({
  open,
  count,
  onClose,
  onConfirm,
}: {
  open: boolean;
  count: number;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{m.settings_security_revoke_all_dialog_title()}</DialogTitle>
          <DialogDescription>
            {m.settings_security_revoke_all_dialog_body({ count })}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_security_dialog_cancel()}
          </Button>
          <Button variant="destructive" onClick={onConfirm} data-testid="confirm-revoke-all">
            {m.settings_security_revoke_all_confirm()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ActiveSessionsCard({ sessions }: { sessions: ReadonlyArray<DisplaySession> }) {
  const revokeOne = useRevokeSession();
  const revokeOthers = useRevokeOtherSessions();
  const [revokeOneTarget, setRevokeOneTarget] = useState<DisplaySession | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const others = sessions.filter((s) => !s.current).length;

  const doRevokeOne = () => {
    if (!revokeOneTarget) return;
    revokeOne.mutate(revokeOneTarget.token, {
      onSuccess: () => toast.success(m.settings_security_toast_session_revoked()),
      onError: (err) => toast.error(err.message),
    });
    setRevokeOneTarget(null);
  };

  const doRevokeAll = () => {
    revokeOthers.mutate(undefined, {
      onSuccess: () =>
        toast.success(m.settings_security_toast_signed_out_others({ count: others })),
      onError: (err) => toast.error(err.message),
    });
    setRevokeAll(false);
  };

  return (
    <SettingsCard>
      <SettingsCardHeader
        title={m.settings_security_sessions_title()}
        description={m.settings_security_sessions_description()}
        action={
          others > 0 ? (
            <Button variant="outline" size="sm" onClick={() => setRevokeAll(true)}>
              {m.settings_security_sessions_signout_others()}
            </Button>
          ) : null
        }
      />
      {sessions.length === 0 ? (
        <p className="px-6 py-8 text-center text-sm text-muted-foreground">
          {m.settings_security_sessions_empty()}
        </p>
      ) : (
        <ul role="list" className="flex flex-col">
          {sessions.map((s, i) => (
            <SessionListRow
              key={s.id}
              session={s}
              isFirst={i === 0}
              onRevoke={() => setRevokeOneTarget(s)}
            />
          ))}
        </ul>
      )}
      <RevokeSessionDialog
        session={revokeOneTarget}
        onClose={() => setRevokeOneTarget(null)}
        onConfirm={doRevokeOne}
      />
      <RevokeAllSessionsDialog
        open={revokeAll}
        count={others}
        onClose={() => setRevokeAll(false)}
        onConfirm={doRevokeAll}
      />
    </SettingsCard>
  );
}

function SessionListRow({
  session,
  isFirst,
  onRevoke,
}: {
  session: DisplaySession;
  isFirst: boolean;
  onRevoke: () => void;
}) {
  const ua = useMemo(() => parseUserAgent(session.userAgent ?? null), [session.userAgent]);
  const showIp = !ua.unknown && !!session.ipAddress;
  const created = new Date(session.createdAt);
  const updated = new Date(session.updatedAt);
  return (
    <li
      data-testid={`session-row-${session.id}`}
      className={cn(
        "flex items-start gap-3 px-5 py-4 sm:px-6",
        !isFirst && "border-t border-border",
      )}
    >
      <NameGlyph name={ua.label} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-foreground">{ua.label}</span>
          {session.current ? (
            <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
              <CheckIcon className="size-2.5" aria-hidden="true" />
              {m.settings_security_sessions_this_device()}
            </Badge>
          ) : null}
        </div>
        <p className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0 text-xs text-muted-foreground">
          {showIp ? <span className="font-mono">{session.ipAddress}</span> : null}
          <span>
            {m.settings_security_sessions_signed_in({
              time: relativeTime(created),
            })}
          </span>
          <span>
            {m.settings_security_sessions_last_active({
              time: relativeTime(updated),
            })}
          </span>
        </p>
      </div>
      {!session.current ? (
        <Button variant="outline" size="sm" onClick={onRevoke}>
          {m.settings_security_sessions_revoke()}
        </Button>
      ) : null}
    </li>
  );
}
