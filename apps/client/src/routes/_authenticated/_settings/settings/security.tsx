// fallow-ignore-file complexity
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckIcon, EyeIcon, EyeOffIcon, ShieldIcon, XIcon } from "lucide-react";
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
import { Field, FieldError, FieldTitle } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { SettingsErrorBoundary } from "@/shared/components/settings-error-boundary";
import { relativeTime } from "@/shared/lib/relative-time";
import { parseUserAgent } from "@/shared/lib/user-agent";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { MOCK_SESSIONS, type MockSession } from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/security")({
  component: SecurityRoute,
});

function SecurityRoute() {
  return (
    <SettingsErrorBoundary>
      <SecurityPage />
    </SettingsErrorBoundary>
  );
}

export function SecurityPage() {
  const [sessions, setSessions] = useState<ReadonlyArray<MockSession>>(MOCK_SESSIONS);

  const onPasswordChanged = () => {
    setSessions((list) => list.filter((s) => s.current));
  };

  return (
    <div className="flex flex-col gap-7">
      <SettingsPageHeader
        title={m.settings_security_title()}
        description={m.settings_security_description()}
      />
      <ChangePasswordCard onChanged={onPasswordChanged} />
      <ActiveSessionsCard sessions={sessions} setSessions={setSessions} />
    </div>
  );
}

// ─── Change password ────────────────────────────────────────────────────────

const MIN_PASSWORD_LENGTH = 12;

export function ChangePasswordCard({ onChanged }: { onChanged?: () => void }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const tooShort = next.length > 0 && next.length < MIN_PASSWORD_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 && next.length >= MIN_PASSWORD_LENGTH && confirm === next && !submitting;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      reset();
      toast.success(m.settings_security_toast_password_updated());
      onChanged?.();
    }, 400);
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
        <form onSubmit={submit} className="flex flex-col gap-4 p-5 sm:p-6">
          <Field>
            <FieldTitle>{m.settings_security_password_current()}</FieldTitle>
            <PasswordInput
              value={current}
              onChange={setCurrent}
              autoComplete="current-password"
              placeholder={m.settings_security_password_placeholder()}
              data-testid="current-password"
            />
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
            <Button type="button" variant="ghost" size="sm" onClick={reset}>
              {m.settings_security_password_cancel()}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit} data-testid="submit-password">
              {submitting
                ? m.settings_security_password_submitting()
                : m.settings_security_password_submit()}
            </Button>
          </div>
        </form>
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

export function ActiveSessionsCard({
  sessions,
  setSessions,
}: {
  sessions: ReadonlyArray<MockSession>;
  setSessions: (updater: (prev: ReadonlyArray<MockSession>) => ReadonlyArray<MockSession>) => void;
}) {
  const [revokeOne, setRevokeOne] = useState<MockSession | null>(null);
  const [revokeAll, setRevokeAll] = useState(false);

  const others = sessions.filter((s) => !s.current).length;

  const doRevokeOne = () => {
    if (!revokeOne) return;
    setSessions((list) => list.filter((s) => s.id !== revokeOne.id));
    toast.success(m.settings_security_toast_session_revoked());
    setRevokeOne(null);
  };

  const doRevokeAll = () => {
    setSessions((list) => list.filter((s) => s.current));
    toast.success(m.settings_security_toast_signed_out_others({ count: others }));
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
              onRevoke={() => setRevokeOne(s)}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={!!revokeOne}
        onOpenChange={(o) => {
          if (!o) setRevokeOne(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.settings_security_revoke_dialog_title()}</DialogTitle>
            <DialogDescription>
              {revokeOne
                ? m.settings_security_revoke_dialog_body({
                    device: parseUserAgent(revokeOne.userAgent).label,
                  })
                : null}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeOne(null)}>
              {m.settings_security_dialog_cancel()}
            </Button>
            <Button variant="destructive" onClick={doRevokeOne} data-testid="confirm-revoke">
              {m.settings_security_revoke_dialog_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={revokeAll}
        onOpenChange={(o) => {
          if (!o) setRevokeAll(false);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{m.settings_security_revoke_all_dialog_title()}</DialogTitle>
            <DialogDescription>
              {m.settings_security_revoke_all_dialog_body({ count: others })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeAll(false)}>
              {m.settings_security_dialog_cancel()}
            </Button>
            <Button variant="destructive" onClick={doRevokeAll} data-testid="confirm-revoke-all">
              {m.settings_security_revoke_all_confirm()}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsCard>
  );
}

function SessionListRow({
  session,
  isFirst,
  onRevoke,
}: {
  session: MockSession;
  isFirst: boolean;
  onRevoke: () => void;
}) {
  const ua = useMemo(() => parseUserAgent(session.userAgent), [session.userAgent]);
  return (
    <li
      data-testid={`session-row-${session.id}`}
      className={cn(
        "flex items-start gap-3 px-5 py-4 sm:px-6",
        !isFirst && "border-t border-border",
      )}
    >
      <div
        className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground"
        aria-hidden="true"
      >
        <ShieldIcon className="size-4" />
      </div>
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
          {session.ipAddress ? <span className="font-mono">{session.ipAddress}</span> : null}
          <span>
            {m.settings_security_sessions_signed_in({
              time: relativeTime(new Date(session.createdAt)),
            })}
          </span>
          <span>
            {m.settings_security_sessions_last_active({
              time: relativeTime(new Date(session.updatedAt)),
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
