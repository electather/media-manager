import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { m } from "@/paraglide/messages";
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
    // OAuth error codes appended by Better Auth when it redirects to the
    // errorCallbackURL after a failed social sign-in round-trip.
    error: z
      .string()
      .optional()
      .catch(() => undefined),
    error_description: z
      .string()
      .optional()
      .catch(() => undefined),
  }),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect, error, error_description } = Route.useSearch();

  // Prefer the human-readable description when available; fall back to the
  // generic i18n message so the user always gets actionable feedback.
  const oauthError = error ? (error_description ?? m.auth_social_signin_error()) : undefined;

  return <LoginForm redirectTo={redirect} oauthError={oauthError} />;
}
