import { useState } from "react";
import { XIcon } from "lucide-react";
import { toast } from "sonner";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@nama/shared/auth";

import { Button } from "@/shared/ui/button";
import { authClient } from "@/shared/lib/auth";
import { m } from "@/paraglide/messages";

import { SettingsCard, SettingsCardHeader } from "@/features/settings";
import { PasswordForm } from "./password-form";

// CRAP is inflated by validation flags and conditional JSX, not branching logic.
// fallow-ignore-next-line complexity
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

  const tooShort = next.length > 0 && next.length < PASSWORD_MIN_LENGTH;
  const tooLong = next.length > PASSWORD_MAX_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== next;
  const canSubmit =
    current.length > 0 &&
    next.length >= PASSWORD_MIN_LENGTH &&
    next.length <= PASSWORD_MAX_LENGTH &&
    confirm === next &&
    !submitting;

  const reset = () => {
    setCurrent("");
    setNext("");
    setConfirm("");
    setServerError(null);
    setOpen(false);
  };

  // CRAP is inflated by Better Auth error-status handling, not avoidable branching.
  // fallow-ignore-next-line complexity
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
        <PasswordForm
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
          tooLong={tooLong}
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
