// fallow-ignore-file complexity
import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  EyeIcon,
  EyeOffIcon,
  LayersIcon,
  LoaderCircleIcon,
  ShieldIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { toast } from "sonner";

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
import { m } from "@/paraglide/messages";

import { SettingsPageHeader } from "@/app/settings-layout";
import { SettingsActionRow, SettingsCard } from "@/features/settings";
import { MOCK_USER } from "@/features/settings/mocks";

export const Route = createFileRoute("/_authenticated/_settings/settings/danger")({
  component: DangerRoute,
});

function DangerRoute() {
  return (
    <SettingsErrorBoundary>
      <DangerPage />
    </SettingsErrorBoundary>
  );
}

function DangerPage() {
  const [reauthOpen, setReauthOpen] = useState(false);
  const [exportLocked, setExportLocked] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const startExport = () => setReauthOpen(true);

  const confirmExport = () => {
    setReauthOpen(false);
    setExportLocked(true);
    toast.success(m.settings_danger_toast_export_started());
    window.setTimeout(() => setExportLocked(false), 1500);
  };

  const confirmDelete = () => {
    setDeleteOpen(false);
    toast.success(m.settings_danger_toast_account_deleted());
  };

  return (
    <div className="flex flex-col gap-6">
      <SettingsPageHeader
        title={m.settings_danger_title()}
        description={m.settings_danger_description()}
      />

      {/* Export */}
      <SettingsCard>
        <SettingsActionRow
          icon={<LayersIcon className="size-4" aria-hidden="true" />}
          title={m.settings_danger_export_title()}
          description={m.settings_danger_export_description()}
          action={
            <Button
              variant="outline"
              size="sm"
              disabled={exportLocked}
              onClick={startExport}
              data-testid="export-data"
            >
              {exportLocked ? (
                <>
                  <LoaderCircleIcon className="size-3.5 animate-spin" />
                  {m.settings_danger_export_preparing()}
                </>
              ) : (
                m.settings_danger_export_action()
              )}
            </Button>
          }
        />
      </SettingsCard>

      {/* Delete */}
      <SettingsCard className="border-destructive/30 bg-destructive/5">
        <SettingsActionRow
          destructive
          icon={<TriangleAlertIcon className="size-4" aria-hidden="true" />}
          title={m.settings_danger_delete_title()}
          description={m.settings_danger_delete_description()}
          action={
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteOpen(true)}
              data-testid="open-delete"
            >
              {m.settings_danger_delete_action()}
            </Button>
          }
        />
      </SettingsCard>

      <ReauthDialog
        open={reauthOpen}
        onClose={() => setReauthOpen(false)}
        onConfirm={confirmExport}
      />
      <DeleteAccountDialog
        open={deleteOpen}
        email={MOCK_USER.email}
        onClose={() => setDeleteOpen(false)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

// ─── Reauth (export) ────────────────────────────────────────────────────────

function ReauthDialog({
  open,
  onClose,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [pw, setPw] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setPw("");
      setSubmitting(false);
    }
  }, [open]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!pw) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      onConfirm();
    }, 350);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <ShieldIcon className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle>{m.settings_danger_reauth_title()}</DialogTitle>
          </div>
          <DialogDescription>{m.settings_danger_reauth_description()}</DialogDescription>
        </DialogHeader>
        <form id="reauth-form" onSubmit={submit} className="flex flex-col gap-3">
          <Field>
            <FieldTitle>{m.settings_danger_reauth_password_label()}</FieldTitle>
            <RevealInput
              value={pw}
              onChange={setPw}
              placeholder={m.settings_danger_reauth_password_placeholder()}
              autoComplete="current-password"
              autoFocus
            />
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_danger_dialog_cancel()}
          </Button>
          <Button form="reauth-form" type="submit" disabled={!pw || submitting}>
            {submitting ? m.settings_danger_reauth_verifying() : m.settings_danger_reauth_cta()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Delete account dialog ──────────────────────────────────────────────────

function DeleteAccountDialog({
  open,
  email,
  onClose,
  onConfirm,
}: {
  open: boolean;
  email: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [pw, setPw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setTyped("");
      setPw("");
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  const emailMatches = typed.trim().toLowerCase() === email.toLowerCase();
  const canSubmit = emailMatches && pw.length > 0 && !submitting;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    window.setTimeout(() => {
      setSubmitting(false);
      onConfirm();
    }, 350);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent>
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
              <TriangleAlertIcon className="size-4" aria-hidden="true" />
            </div>
            <DialogTitle>{m.settings_danger_delete_title()}</DialogTitle>
          </div>
        </DialogHeader>
        <form id="delete-form" onSubmit={submit} className="flex flex-col gap-3">
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm leading-relaxed text-destructive">
            {m.settings_danger_delete_dialog_warning()}
          </p>
          <Field data-invalid={typed.length > 0 && !emailMatches ? true : undefined}>
            <FieldTitle>{m.settings_danger_delete_dialog_email_label({ email })}</FieldTitle>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={email}
              autoComplete="off"
              spellCheck={false}
              aria-invalid={typed.length > 0 && !emailMatches ? true : undefined}
              data-testid="delete-email"
              className="font-mono text-sm"
            />
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldTitle>{m.settings_danger_reauth_password_label()}</FieldTitle>
            <RevealInput
              value={pw}
              onChange={(v) => {
                setPw(v);
                if (error) setError(null);
              }}
              placeholder={m.settings_danger_reauth_password_placeholder()}
              autoComplete="current-password"
              ariaInvalid={!!error}
              data-testid="delete-password"
            />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {m.settings_danger_dialog_cancel()}
          </Button>
          <Button
            form="delete-form"
            type="submit"
            variant="destructive"
            disabled={!canSubmit}
            data-testid="confirm-delete"
          >
            {submitting
              ? m.settings_danger_delete_dialog_deleting()
              : m.settings_danger_delete_action()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Local password input ───────────────────────────────────────────────────

interface RevealInputProps {
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  autoComplete?: string;
  autoFocus?: boolean;
  ariaInvalid?: boolean;
  "data-testid"?: string;
}

function RevealInput(props: RevealInputProps) {
  const [shown, setShown] = useState(false);
  const { value, onChange, ...rest } = props;
  return (
    <div className="relative">
      <Input
        type={shown ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={rest.autoComplete}
        autoFocus={rest.autoFocus}
        placeholder={rest.placeholder}
        aria-invalid={rest.ariaInvalid ? true : undefined}
        data-testid={rest["data-testid"]}
        className="pr-10"
      />
      <button
        type="button"
        onClick={() => setShown((s) => !s)}
        aria-label={shown ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-1 flex w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground"
      >
        {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
      </button>
    </div>
  );
}
