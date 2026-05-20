import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { authClient } from "@/shared/lib/auth";
import { m } from "@/paraglide/messages";
import { createUserSchema } from "@ent-mcp/shared/users";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";

export const Route = createFileRoute("/auth/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const resetMutation = useMutation({
    mutationFn: async ({ email }: { email: string }) => {
      const { error } = await authClient.requestPasswordReset({
        email,
        redirectTo: "/auth/reset-password",
      });
      if (error) throw new Error(error.message ?? "Something went wrong.");
    },
  });

  const form = useForm({
    defaultValues: { email: "" },
    onSubmit: async ({ value }) => {
      await resetMutation.mutateAsync(value);
    },
  });

  const canSubmit = !form.state.isSubmitting && !resetMutation.isPending;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight text-center text-foreground font-serif">
        {m.auth_reset_password()}
      </h1>

      {resetMutation.isSuccess ? (
        <div className="text-center text-sm text-muted-foreground space-y-4 py-4">
          <p>{m.auth_check_inbox()}</p>
          <Link
            to="/auth/login"
            className="text-foreground hover:text-primary underline underline-offset-4 font-medium transition-colors"
          >
            {m.auth_back_to_login()}
          </Link>
        </div>
      ) : (
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
              onChange: ({ value }) => {
                if (!value) return "Email is required.";
                const result = createUserSchema.shape.email.safeParse(value);
                if (!result.success) return "Enter a valid email address.";
                return undefined;
              },
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
            <span className="text-sm text-destructive text-center font-medium">
              {resetMutation.error.message}
            </span>
          )}

          <Button type="submit" className="w-full h-10 mt-2 font-bold" disabled={!canSubmit}>
            {resetMutation.isPending ? m.auth_sending() : m.auth_send_reset_link()}
          </Button>

          <div className="text-center text-muted-foreground text-sm mt-4">
            {m.auth_remember_password()}{" "}
            <Link
              to="/auth/login"
              className="text-foreground hover:text-primary underline underline-offset-4 font-medium transition-colors"
            >
              {m.auth_log_in()}
            </Link>
            .
          </div>
        </form>
      )}
    </div>
  );
}
