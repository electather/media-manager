// Inherently multi-state UI (preview loading/invalid/gone + accept form with
// email-taken and sign-in-failed branches); CRAP is branch-count driven with no
// unit coverage. Matches the existing suppression on invite-row.tsx.
// fallow-ignore-file complexity
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { PasswordField, validateEmail, validateNewPassword } from "@/features/auth";
import { authClient } from "@/shared/lib/auth";
import { fetchInvitePreview, acceptInvite } from "@/features/admin-users/lib/fetchers";
import { AdminUsersApiError } from "@/features/admin-users/lib/types";

export const Route = createFileRoute("/auth/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();

  const preview = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => fetchInvitePreview(token),
    retry: false,
  });

  if (preview.isPending) {
    return <LoadingState />;
  }

  if (preview.data === null) {
    return <InvalidState />;
  }

  if (preview.data === "gone") {
    return <GoneState />;
  }

  if (preview.isError) {
    return <InvalidState />;
  }

  return <AcceptForm code={token} roleName={preview.data.roleName} />;
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="h-4 w-64 animate-pulse rounded bg-muted" />
    </div>
  );
}

function InvalidState() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_invite_invalid_title()}
      </h1>
      <p className="text-center text-sm text-muted-foreground">{m.auth_invite_invalid_body()}</p>
      <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
        {m.auth_invite_go_to_login()}
      </Button>
    </div>
  );
}

function GoneState() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_invite_gone_title()}
      </h1>
      <p className="text-center text-sm text-muted-foreground">{m.auth_invite_gone_body()}</p>
      <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
        {m.auth_invite_go_to_login()}
      </Button>
    </div>
  );
}

/** Maps TanStack Form field errors to the shape `<FieldError>` expects. */
function fieldErrors(errors: (string | undefined)[]) {
  return errors.map((message) => ({ message }));
}

/** Recovery banner shown when the account was created but sign-in failed. */
function SignInFailedState() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_invite_title()}
      </h1>
      <p className="mt-1 text-center text-sm font-medium text-destructive">
        {m.auth_invite_account_created_signin_failed()}
      </p>
      <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
        {m.auth_invite_go_to_login()}
      </Button>
    </div>
  );
}

function InviteHeader({ roleName }: { roleName: string }) {
  return (
    <div>
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_invite_title()}
      </h1>
      <p className="mt-1 text-center text-sm text-muted-foreground">{m.auth_invite_subtitle()}</p>
      {roleName ? (
        <p className="mt-2 text-center text-xs text-muted-foreground">
          {m.auth_invite_role_label()}{" "}
          <span className="font-medium text-foreground">{roleName}</span>
        </p>
      ) : null}
    </div>
  );
}

type AcceptValues = { name: string; email: string; password: string };

/**
 * Drives the accept → sign-in flow. On success it signs the new account in with
 * the submitted credentials and redirects to `/setup`; a transient sign-in
 * failure surfaces `signInFailed`, and a duplicate email (409) surfaces
 * `emailTaken`. Keeping the branching here keeps `AcceptForm` declarative.
 */
function useAcceptInvite(code: string) {
  const navigate = useNavigate();
  const [signInFailed, setSignInFailed] = useState(false);
  const [emailTaken, setEmailTaken] = useState(false);

  const mutation = useMutation({
    mutationFn: (values: AcceptValues) => acceptInvite(code, values),
    onSuccess: async (_data, variables) => {
      const { error } = await authClient.signIn.email({
        email: variables.email,
        password: variables.password,
        rememberMe: true,
      });
      // Account exists but sign-in failed (transient): send the user to login
      // rather than letting them retry the form (which would 409).
      if (error) return setSignInFailed(true);
      void navigate({ to: "/setup" });
    },
    onError: (err) => {
      if (err instanceof AdminUsersApiError && err.status === 409) setEmailTaken(true);
    },
  });

  const submit = async (values: AcceptValues) => {
    setEmailTaken(false);
    setSignInFailed(false);
    await mutation.mutateAsync(values);
  };

  return { mutation, submit, signInFailed, emailTaken, setEmailTaken };
}

/** True when the mutation failed with something other than a 409 duplicate-email. */
function isGenericAcceptError(error: unknown): boolean {
  return Boolean(error) && !(error instanceof AdminUsersApiError && error.status === 409);
}

function AcceptForm({ code, roleName }: { code: string; roleName: string }) {
  const { mutation, submit, signInFailed, emailTaken, setEmailTaken } = useAcceptInvite(code);

  const form = useForm({
    defaultValues: { name: "", email: "", password: "" },
    onSubmit: ({ value }) => submit(value),
  });

  const isBusy = form.state.isSubmitting || mutation.isPending || mutation.isSuccess;

  if (signInFailed) {
    return <SignInFailedState />;
  }

  return (
    <div className="flex flex-col gap-4">
      <InviteHeader roleName={roleName} />

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="name"
          validators={{
            onBlur: ({ value }) => (!value.trim() ? m.auth_name_required() : undefined),
            onSubmit: ({ value }) => (!value.trim() ? m.auth_name_required() : undefined),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="name">{m.auth_name()}</FieldLabel>
              <Input
                id="name"
                type="text"
                placeholder="Your name"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="name"
                disabled={isBusy}
              />
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || emailTaken || undefined}>
              <FieldLabel htmlFor="email">{m.auth_email()}</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@domain.com"
                value={field.state.value}
                onChange={(e) => {
                  setEmailTaken(false);
                  field.handleChange(e.target.value);
                }}
                onBlur={field.handleBlur}
                autoComplete="email"
                disabled={isBusy}
              />
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
              {emailTaken ? (
                <p className="text-sm text-destructive">
                  {m.auth_invite_email_taken()}{" "}
                  <Link
                    to="/auth/login"
                    className="font-medium underline underline-offset-4 transition-colors hover:text-primary"
                  >
                    {m.auth_invite_email_taken_login()}
                  </Link>
                </p>
              ) : null}
            </Field>
          )}
        </form.Field>

        <form.Field
          name="password"
          validators={{
            onBlur: ({ value }) => validateNewPassword(value),
            onSubmit: ({ value }) => validateNewPassword(value),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="password">{m.auth_password()}</FieldLabel>
              <PasswordField
                id="password"
                value={field.state.value}
                autoComplete="new-password"
                disabled={isBusy}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError errors={fieldErrors(field.state.meta.errors)} />
            </Field>
          )}
        </form.Field>

        {isGenericAcceptError(mutation.error) ? (
          <p className="mt-1 text-center text-sm font-medium text-destructive">
            {mutation.error?.message}
          </p>
        ) : null}

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={isBusy}>
          {m.auth_invite_submit({ status: mutation.status })}
        </Button>
      </form>
    </div>
  );
}
