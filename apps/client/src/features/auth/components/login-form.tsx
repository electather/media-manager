import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { useState } from "react";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Field, FieldLabel, FieldError, FieldDescription } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { Separator } from "@/shared/ui/separator";
import { useLogin } from "../hooks/use-login";
import { validateEmail, validateLoginPassword } from "../lib/validators";
import { PasswordField } from "./password-field";
import { SocialButtons } from "./social-buttons";

export interface LoginFormProps {
  redirectTo: string | undefined;
}

export function LoginForm({ redirectTo }: LoginFormProps) {
  const loginMutation = useLogin(redirectTo);
  const [rememberMe, setRememberMe] = useState(true);

  const form = useForm({
    defaultValues: { email: "", password: "" },
    onSubmit: async ({ value }) => {
      await loginMutation.mutateAsync({ ...value, rememberMe });
    },
  });

  const canSubmit = !form.state.isSubmitting && loginMutation.status !== "pending";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-sans text-2xl font-bold tracking-tight text-foreground">
        {m.auth_sign_in_to_continue()}
      </h1>

      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void form.handleSubmit();
        }}
      >
        <form.Field
          name="email"
          validators={{
            onBlur: ({ value }) => validateEmail(value),
            onSubmit: ({ value }) => validateEmail(value),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="email">{m.auth_email()}</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@domain.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="email"
                disabled={loginMutation.status === "pending"}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="password"
          validators={{
            onBlur: ({ value }) => validateLoginPassword(value),
            onSubmit: ({ value }) => validateLoginPassword(value),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="password">{m.auth_password()}</FieldLabel>
              <PasswordField
                id="password"
                value={field.state.value}
                autoComplete="current-password"
                disabled={loginMutation.status === "pending"}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        {loginMutation.error && (
          <span className="mt-1 text-center text-sm font-medium text-destructive">
            {loginMutation.error.message}
          </span>
        )}

        <div className="mt-2 flex items-center justify-between">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
            <Checkbox checked={rememberMe} onCheckedChange={(v) => setRememberMe(v === true)} />
            <span>{m.auth_stay_signed_in()}</span>
          </label>
          <Link
            to="/auth/forgot-password"
            className="text-sm font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            {m.auth_forgot_password_question()}
          </Link>
        </div>

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={!canSubmit}>
          {m.auth_login_submit({ status: loginMutation.status })}
        </Button>

        <div className="flex items-center gap-3">
          <Separator className="h-px flex-1" />
          <span className="text-xs font-light tracking-widest text-muted-foreground uppercase">
            {m.auth_or_continue_with()}
          </span>
          <Separator className="h-px flex-1" />
        </div>

        <SocialButtons />
        <FieldDescription className="text-center">
          {m.auth_no_account_question()}{" "}
          <Link
            to="/auth/register"
            className="font-medium text-foreground underline underline-offset-4 transition-colors hover:text-primary"
          >
            {m.auth_sign_up()}
          </Link>
        </FieldDescription>
      </form>
    </div>
  );
}
