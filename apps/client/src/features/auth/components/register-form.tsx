import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { useRegister } from "../hooks/use-register";
import {
  validateConfirmPassword,
  validateEmail,
  validateName,
  validateNewPassword,
} from "../lib/validators";
import { PasswordField } from "./password-field";
import { SocialButtons } from "./social-buttons";

export function RegisterForm() {
  const registerMutation = useRegister();

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirm: "" },
    onSubmit: async ({ value }) => {
      await registerMutation.mutateAsync({
        name: value.name,
        email: value.email,
        password: value.password,
      });
    },
  });

  const canSubmit = !form.state.isSubmitting && registerMutation.status !== "pending";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_create_account()}
      </h1>

      <SocialButtons />

      <div className="relative my-2 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <span className="relative bg-background/5 px-2 text-[10px] font-semibold tracking-widest text-muted-foreground uppercase">
          {m.auth_or_continue_with()}
        </span>
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
              <FieldLabel htmlFor="name">{m.auth_name()}</FieldLabel>
              <Input
                id="name"
                type="text"
                placeholder="Jane Smith"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="name"
                disabled={registerMutation.status === "pending"}
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
              <FieldLabel htmlFor="email">{m.auth_email()}</FieldLabel>
              <Input
                id="email"
                type="email"
                placeholder="you@domain.com"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                autoComplete="email"
                disabled={registerMutation.status === "pending"}
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
              <FieldLabel htmlFor="password">{m.auth_password()}</FieldLabel>
              <PasswordField
                id="password"
                value={field.state.value}
                autoComplete="new-password"
                disabled={registerMutation.status === "pending"}
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
            // Cross-field: confirm must match password. Validate on blur so the
            // error doesn't fire on the very first keystroke, and re-run when
            // the password field blurs so a fix to either field clears the error.
            onBlur: ({ value, fieldApi }) =>
              validateConfirmPassword(value, fieldApi.form.getFieldValue("password")),
            onBlurListenTo: ["password"],
            onSubmit: ({ value, fieldApi }) =>
              validateConfirmPassword(value, fieldApi.form.getFieldValue("password")),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="confirm">{m.auth_confirm_password()}</FieldLabel>
              <PasswordField
                id="confirm"
                value={field.state.value}
                autoComplete="new-password"
                disabled={registerMutation.status === "pending"}
                onChange={field.handleChange}
                onBlur={field.handleBlur}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        {registerMutation.error && (
          <span className="mt-1 text-center text-sm font-medium text-destructive">
            {registerMutation.error.message}
          </span>
        )}

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={!canSubmit}>
          {m.auth_register_submit({ status: registerMutation.status })}
        </Button>

        <div className="mt-4 text-center text-sm text-muted-foreground">
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
