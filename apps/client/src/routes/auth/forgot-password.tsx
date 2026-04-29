import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { authClient } from "@/shared/lib/auth";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Reset your password</CardTitle>
          <CardDescription>Enter your email and we&apos;ll send you a reset link</CardDescription>
        </CardHeader>
        <CardContent>
          {resetMutation.isSuccess ? (
            <div className="text-center text-sm text-muted-foreground space-y-4">
              <p>Check your inbox for a password reset link.</p>
              <Link to="/auth/login" className="underline underline-offset-4 hover:text-primary">
                Back to login
              </Link>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void form.handleSubmit();
              }}
            >
              <FieldGroup>
                <form.Field
                  name="email"
                  validators={{
                    onBlur: ({ value }) => {
                      if (!value) return "Email is required.";
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value))
                        return "Enter a valid email address.";
                      return undefined;
                    },
                  }}
                >
                  {(field) => (
                    <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input
                        id="email"
                        type="email"
                        placeholder="m@example.com"
                        value={field.state.value}
                        onChange={(e) => field.handleChange(e.target.value)}
                        onBlur={field.handleBlur}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <FieldError>{field.state.meta.errors.join(", ")}</FieldError>
                      )}
                    </Field>
                  )}
                </form.Field>
                {resetMutation.error && <FieldError>{resetMutation.error.message}</FieldError>}
                <form.Subscribe selector={(state) => state.isSubmitting}>
                  {(isSubmitting) => (
                    <Field>
                      <Button type="submit" disabled={isSubmitting}>
                        {isSubmitting ? "Sending…" : "Send reset link"}
                      </Button>
                      <FieldDescription className="text-center">
                        Remember your password? <Link to="/auth/login">Log in</Link>
                      </FieldDescription>
                    </Field>
                  )}
                </form.Subscribe>
              </FieldGroup>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
