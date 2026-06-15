import { Button } from "@/shared/ui/button";
import { Field, FieldError, FieldTitle } from "@/shared/ui/field";
import { m } from "@/paraglide/messages";

import { PasswordInput } from "./password-input";
import { PasswordMeter } from "./password-meter";

export interface PasswordFormProps {
  current: string;
  next: string;
  confirm: string;
  setCurrent: (v: string) => void;
  setNext: (v: string) => void;
  setConfirm: (v: string) => void;
  tooShort: boolean;
  tooLong: boolean;
  mismatch: boolean;
  canSubmit: boolean;
  submitting: boolean;
  serverError: string | null;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
}

export function PasswordForm({
  current,
  next,
  confirm,
  setCurrent,
  setNext,
  setConfirm,
  tooShort,
  tooLong,
  mismatch,
  canSubmit,
  submitting,
  serverError,
  onSubmit,
  onCancel,
}: PasswordFormProps) {
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
      <Field data-invalid={tooShort || tooLong ? true : undefined}>
        <FieldTitle>{m.settings_security_password_new()}</FieldTitle>
        <PasswordInput
          value={next}
          onChange={setNext}
          autoComplete="new-password"
          placeholder={m.settings_security_password_new_placeholder()}
          ariaInvalid={tooShort || tooLong}
          data-testid="new-password"
        />
        <PasswordMeter value={next} />
        {tooShort ? (
          <FieldError>{m.settings_security_password_too_short()}</FieldError>
        ) : tooLong ? (
          <FieldError>{m.settings_security_password_too_long()}</FieldError>
        ) : null}
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
