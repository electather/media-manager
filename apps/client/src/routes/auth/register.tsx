import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useForm } from "@tanstack/react-form";
import { authClient } from "@/shared/lib/auth";
import { m } from "@/paraglide/messages";
import { createUserSchema } from "@ent-mcp/shared/users";
import { Input } from "@/shared/ui/input";
import { Button } from "@/shared/ui/button";
import { Field, FieldLabel, FieldError } from "@/shared/ui/field";

export const Route = createFileRoute("/auth/register")({
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();

  const registerMutation = useMutation({
    mutationFn: async ({
      name,
      email,
      password,
    }: {
      name: string;
      email: string;
      password: string;
      confirm: string;
    }) => {
      const { error } = await authClient.signUp.email({ name, email, password });
      if (error) throw new Error(error.message ?? "Registration failed.");
    },
    onSuccess: () => navigate({ to: "/" }),
  });

  const socialMutation = useMutation({
    mutationFn: (provider: "apple" | "google") =>
      authClient.signIn.social({ provider, callbackURL: "/dashboard" }),
  });

  const form = useForm({
    defaultValues: { name: "", email: "", password: "", confirm: "" },
    validators: {
      onChange: ({ value }) => {
        if (value.password && value.confirm && value.password !== value.confirm) {
          return { fields: { confirm: "Passwords do not match." } };
        }
        return undefined;
      },
    },
    onSubmit: async ({ value }) => {
      await registerMutation.mutateAsync(value);
    },
  });

  const canSubmit = !form.state.isSubmitting && registerMutation.status !== "pending";

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold tracking-tight text-center text-foreground font-serif">
        {m.auth_create_account()}
      </h1>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-10 font-semibold flex items-center justify-center gap-2 w-full"
          disabled={socialMutation.isPending}
          onClick={() => socialMutation.mutate("google")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"
            />
          </svg>
          {m.auth_google()}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-10 font-semibold flex items-center justify-center gap-2 w-full"
          disabled={socialMutation.isPending}
          onClick={() => socialMutation.mutate("apple")}
        >
          <svg width="18" height="18" viewBox="0 0 24 24">
            <path
              fill="currentColor"
              d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"
            />
          </svg>
          {m.auth_apple()}
        </Button>
      </div>

      <div className="relative my-2 flex items-center justify-center">
        <div className="absolute inset-0 flex items-center">
          <div className="w-full border-t border-border" />
        </div>
        <span className="relative bg-background/5 px-2 text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
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
            onChange: ({ value }) => {
              if (!value.trim()) return "Name is required.";
              const result = createUserSchema.shape.name.safeParse(value);
              if (!result.success) return "Enter a valid name.";
              return undefined;
            },
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
                disabled={registerMutation.status === "pending"}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

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
                disabled={registerMutation.status === "pending"}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="password"
          validators={{
            onChange: ({ value }) => {
              if (!value) return "Password is required.";
              const result = createUserSchema.shape.password.safeParse(value);
              if (!result.success) return "Password must be at least 8 characters.";
              return undefined;
            },
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="password">{m.auth_password()}</FieldLabel>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={registerMutation.status === "pending"}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        <form.Field
          name="confirm"
          validators={{
            onChange: ({ value }) => (!value ? "Please confirm your password." : undefined),
          }}
        >
          {(field) => (
            <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
              <FieldLabel htmlFor="confirm">{m.auth_confirm_password()}</FieldLabel>
              <Input
                id="confirm"
                type="password"
                placeholder="••••••••"
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                disabled={registerMutation.status === "pending"}
              />
              <FieldError errors={field.state.meta.errors.map((message) => ({ message }))} />
            </Field>
          )}
        </form.Field>

        {registerMutation.error && (
          <span className="text-sm text-destructive text-center font-medium mt-1">
            {registerMutation.error.message}
          </span>
        )}

        <Button type="submit" className="w-full h-10 mt-2 font-bold" disabled={!canSubmit}>
          {registerMutation.status === "pending"
            ? m.auth_creating_account()
            : m.auth_create_account()}
        </Button>

        <div className="text-center text-muted-foreground text-sm mt-4">
          {m.auth_already_have_account()}{" "}
          <Link
            to="/auth/login"
            className="text-foreground hover:text-primary underline underline-offset-4 font-medium transition-colors"
          >
            {m.auth_log_in()}
          </Link>
          .
        </div>
      </form>
    </div>
  );
}
