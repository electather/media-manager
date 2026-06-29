import { Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { bootstrapClaimSchema } from "@nama/shared/bootstrap";
import { passwordIssueReason } from "@nama/shared/auth";
import { AuthShell, PasswordField } from "@/features/auth";
import { m } from "@/paraglide/messages";
import { authClient } from "@/shared/lib/auth";
import { Button } from "@/shared/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { useClaimBootstrap } from "../hooks/use-claim-bootstrap";
import { OnboardingApiError } from "../lib/types";

/** Public first-install page. Renders the bootstrap form inside the shared auth shell. */
export function BootstrapPage() {
  return (
    <AuthShell>
      <BootstrapForm />
    </AuthShell>
  );
}

/**
 * Resolves the thrown claim error to a user-facing message. `invalid_token`
 * gets a targeted hint; anything else falls back to the generic failure copy.
 * The `already_completed` 409 is handled separately by swapping the whole form.
 */
function claimErrorMessage(error: Error): string {
  if (error instanceof OnboardingApiError && error.code === "bootstrap.invalid_token") {
    return m.onboarding_bootstrap_invalid_token();
  }
  return m.onboarding_bootstrap_failed();
}

function isAlreadyCompleted(error: Error | null): boolean {
  return error instanceof OnboardingApiError && error.code === "bootstrap.already_completed";
}

/**
 * Returns the localized message to show when a field is invalid. The validation
 * RULES come from the shared `bootstrapClaimSchema` (see the field validators
 * below); each field carries exactly one rule, so a single localized message per
 * field is sufficient. This keeps client and server validation identical while
 * still rendering translated copy.
 */
function fieldError(hasError: boolean, message: string): { message: string }[] {
  return hasError ? [{ message }] : [];
}

// Form with per-field validation plus already-completed / error / pending
// branches; CRAP is coverage-estimated in CI and is covered by
// bootstrap-form-validation.test.tsx.
// fallow-ignore-next-line complexity
function BootstrapForm() {
  const navigate = useNavigate();
  const claim = useClaimBootstrap();

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", token: "" },
    onSubmit: async ({ value }) => {
      await claim.mutateAsync(value);
      // The admin account now exists and the one-time token is spent. Establish
      // the session and send the operator to the wizard. A slow or failing
      // sign-in must never strand them on a consumed token, so cap the wait and
      // fall back to the login page — the account is already created and can
      // sign in there.
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          authClient.signIn.email({ email: value.email, password: value.password }),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error("bootstrap-signin-timeout")), 10_000);
          }),
        ]);
        void navigate({ to: "/setup" });
      } catch {
        void navigate({ to: "/auth/login" });
      } finally {
        clearTimeout(timer);
      }
    },
  });

  const pending = form.state.isSubmitting || claim.isPending;

  // A stale tab or a race against another operator can hit an already-set-up
  // server. Swap the form for a login pointer rather than a confusing error.
  if (isAlreadyCompleted(claim.error)) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-sans text-2xl font-bold tracking-tight text-foreground">
          {m.onboarding_bootstrap_already_done_title()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {m.onboarding_bootstrap_already_done_body()}
        </p>
        <Button render={<Link to="/auth/login" />} className="mt-2 h-10 w-full font-bold">
          {m.onboarding_bootstrap_go_to_login()}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-sans text-2xl font-bold tracking-tight text-foreground">
        {m.onboarding_bootstrap_heading()}
      </h1>
      <p className="text-center text-sm text-muted-foreground">{m.onboarding_bootstrap_intro()}</p>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        {/* Field rules are the shared `bootstrapClaimSchema` (the exact schema the
            server validates), consumed per field via its `.shape` — no hand-written
            validators. */}
        <form.Field
          name="name"
          validators={{
            onBlur: bootstrapClaimSchema.shape.name,
            onSubmit: bootstrapClaimSchema.shape.name,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="bootstrap-name">
                {m.onboarding_bootstrap_name_label()}
              </FieldLabel>
              <Input
                id="bootstrap-name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="name"
                disabled={pending}
              />
              <FieldError
                errors={fieldError(
                  field.state.meta.errors.length > 0,
                  m.onboarding_bootstrap_name_required(),
                )}
              />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="email"
          validators={{
            onBlur: bootstrapClaimSchema.shape.email,
            onSubmit: bootstrapClaimSchema.shape.email,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="bootstrap-email">
                {m.onboarding_bootstrap_email_label()}
              </FieldLabel>
              <Input
                id="bootstrap-email"
                type="email"
                placeholder="you@domain.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="email"
                disabled={pending}
              />
              <FieldError
                errors={fieldError(
                  field.state.meta.errors.length > 0,
                  m.onboarding_bootstrap_email_invalid(),
                )}
              />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="password"
          validators={{
            onBlur: bootstrapClaimSchema.shape.password,
            onSubmit: bootstrapClaimSchema.shape.password,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="bootstrap-password">
                {m.onboarding_bootstrap_password_label()}
              </FieldLabel>
              <PasswordField
                id="bootstrap-password"
                value={field.state.value}
                autoComplete="new-password"
                disabled={pending}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError
                errors={fieldError(
                  field.state.meta.errors.length > 0,
                  // `??` is unreachable: errors.length > 0 means the value failed the
                  // same schema passwordIssueReason mirrors, so it returns non-null here.
                  m.shared_password_error({
                    reason: passwordIssueReason(field.state.value) ?? "too_short",
                  }),
                )}
              />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="token"
          validators={{
            onBlur: bootstrapClaimSchema.shape.token,
            onSubmit: bootstrapClaimSchema.shape.token,
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="bootstrap-token">
                {m.onboarding_bootstrap_token_label()}
              </FieldLabel>
              <Input
                id="bootstrap-token"
                placeholder={m.onboarding_bootstrap_token_placeholder()}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="off"
                disabled={pending}
              />
              <FieldError
                errors={fieldError(
                  field.state.meta.errors.length > 0,
                  m.onboarding_bootstrap_token_required(),
                )}
              />
            </Field>
          )}
        </form.Field>

        {claim.error && !isAlreadyCompleted(claim.error) && (
          <span className="mt-1 text-center text-sm font-medium text-destructive">
            {claimErrorMessage(claim.error)}
          </span>
        )}

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={pending}>
          {m.onboarding_bootstrap_submit({ status: pending ? "pending" : "idle" })}
        </Button>
      </form>
    </div>
  );
}
