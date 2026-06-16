import { useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useQuery, useMutation } from "@tanstack/react-query";

import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { authClient } from "@/shared/lib/auth";
import { PasswordField } from "@/features/auth";
import { fetchInvitePreview, acceptInvite } from "@/features/admin-users/lib/fetchers";
import {
  validateEmail,
  validateName,
  validateNewPassword,
  validateConfirmPassword,
} from "@/features/auth/lib/validators";

export const Route = createFileRoute("/auth/invite/$token")({
  component: InvitePage,
});

function InvitePage() {
  const { token } = Route.useParams();
  const navigate = useNavigate();
  const [accountCreated, setAccountCreated] = useState(false);

  const previewQuery = useQuery({
    queryKey: ["invite-preview", token],
    queryFn: () => fetchInvitePreview(token),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      acceptInvite(token, input),
  });

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      await acceptMutation.mutateAsync(
        { name: value.name.trim(), email: value.email, password: value.password },
        {
          onSuccess: async () => {
            setAccountCreated(true);
            // Sign in client-side with the newly created credentials. The server
            // minted no session; Better Auth's sign-in/email reads the credential
            // account row we just wrote.
            const { error } = await authClient.signIn.email({
              email: value.email,
              password: value.password,
              rememberMe: true,
            });
            if (error) {
              // Account was created but sign-in failed (transient error). Show a
              // recovery banner — do not retry form, which would 409.
              return;
            }
            void navigate({ to: "/setup" });
          },
        },
      );
    },
  });

  const isBusy = form.state.isSubmitting || acceptMutation.isPending;
  const is409 = acceptMutation.error instanceof Error && acceptMutation.status === "error";
  const errorCode = is409
    ? (acceptMutation.error as Error & { status?: number }).message
    : undefined;

  if (previewQuery.isPending) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-sm text-muted-foreground">{m.auth_invite_loading()}</p>
      </div>
    );
  }

  if (previewQuery.isError) {
    const err = previewQuery.error as Error & { status?: number };
    const isGone = err.status === 410 || err.status === 404;
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          {m.auth_invite_invalid_title()}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isGone ? m.auth_invite_expired_body() : m.auth_invite_error_body()}
        </p>
        <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
          {m.auth_log_in()}
        </Button>
      </div>
    );
  }

  const preview = previewQuery.data;

  // Account was created but subsequent sign-in failed — show recovery path.
  if (accountCreated && acceptMutation.isSuccess && !form.state.isSubmitting) {
    return (
      <div className="flex flex-col gap-4 text-center">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          {m.auth_invite_account_created_title()}
        </h1>
        <p className="text-sm text-muted-foreground">{m.auth_invite_signin_failed_body()}</p>
        <Button variant="link" size="sm" render={<Link to="/auth/login" />}>
          {m.auth_log_in()}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="text-center">
        <h1 className="font-serif text-2xl font-bold tracking-tight text-foreground">
          {m.auth_invite_title()}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {m.auth_invite_subtitle({ roleName: preview.roleName })}
        </p>
      </div>

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
            onBlur: ({ value }) => validateName(value),
            onSubmit: ({ value }) => validateName(value),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="inv-name">{m.auth_name()}</FieldLabel>
              <Input
                id="inv-name"
                type="text"
                placeholder="Jane Smith"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="name"
                disabled={isBusy}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
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
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="inv-email">{m.auth_email()}</FieldLabel>
              <Input
                id="inv-email"
                type="email"
                placeholder="you@domain.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="email"
                disabled={isBusy}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
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
              <FieldLabel htmlFor="inv-password">{m.auth_password()}</FieldLabel>
              <PasswordField
                id="inv-password"
                value={field.state.value}
                autoComplete="new-password"
                disabled={isBusy}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="confirm"
          validators={{
            onBlur: ({ value, fieldApi }) =>
              validateConfirmPassword(value, fieldApi.form.getFieldValue("password")),
            onBlurListenTo: ["password"],
            onSubmit: ({ value, fieldApi }) =>
              validateConfirmPassword(value, fieldApi.form.getFieldValue("password")),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="inv-confirm">{m.auth_confirm_password()}</FieldLabel>
              <PasswordField
                id="inv-confirm"
                value={field.state.value}
                autoComplete="new-password"
                disabled={isBusy}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        {acceptMutation.error && (
          <div className="mt-1 text-center text-sm font-medium text-destructive">
            {acceptMutation.status === "error" && errorCode
              ? m.auth_invite_error_body()
              : (acceptMutation.error as Error).message}
          </div>
        )}

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={isBusy}>
          {m.auth_invite_submit()}
        </Button>

        <div className="mt-2 text-center text-sm text-muted-foreground">
          {m.auth_already_have_account()}{" "}
          <Button
            variant="link"
            size="sm"
            className="h-auto px-0 align-baseline font-medium"
            render={<Link to="/auth/login" />}
          >
            {m.auth_log_in()}
          </Button>
          .
        </div>
      </form>
    </div>
  );
}
