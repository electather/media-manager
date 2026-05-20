import { Link } from "@tanstack/react-router";
import { useForm } from "@tanstack/react-form";
import { m } from "@/paraglide/messages";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";
import { usePasswordReset } from "../hooks/use-password-reset";
import { validateEmail } from "../lib/validators";

export function ForgotPasswordForm() {
  const resetMutation = usePasswordReset();

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      await resetMutation.mutateAsync(value);
    },
  });

  const canSubmit = !form.state.isSubmitting && !resetMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-center font-serif text-2xl font-bold tracking-tight text-foreground">
        {m.auth_reset_password()}
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
                disabled={resetMutation.isPending}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        {resetMutation.error && (
          <span className="text-center text-sm font-medium text-destructive">
            {resetMutation.error.message}
          </span>
        )}

        <Button type="submit" className="mt-2 h-10 w-full font-bold" disabled={!canSubmit}>
          {m.auth_reset_submit({ status: resetMutation.status })}
        </Button>

        <div className="mt-4 text-center text-sm text-muted-foreground">
          {m.auth_remember_password()}{" "}
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
