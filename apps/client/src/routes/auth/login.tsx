import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { LoginForm } from "@/features/auth";

export const Route = createFileRoute("/auth/login")({
  validateSearch: z.object({
    // Restrict redirect to same-origin path-only values to prevent open-redirect
    // and javascript: URI execution via a crafted ?redirect= param.
    redirect: z
      .string()
      .regex(/^\/(?!\/)/)
      .optional()
      .catch(() => undefined),
  }),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect } = Route.useSearch();
  return <LoginForm redirectTo={redirect} />;
}
