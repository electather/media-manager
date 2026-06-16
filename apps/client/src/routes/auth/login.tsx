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
    // OAuth error code appended by Better Auth when it redirects to the
    // errorCallbackURL after a failed social sign-in round-trip. Only the
    // presence of a code is trusted; any provider-supplied description is
    // intentionally ignored. The whole search string is URL-controllable, so
    // reflecting free text would let an attacker render arbitrary phishing
    // copy on the trusted login origin — the same abuse class the redirect
    // sanitization above guards against.
    error: z
      .string()
      .optional()
      .catch(() => undefined),
  }),
  component: LoginRoute,
});

function LoginRoute() {
  const { redirect, error } = Route.useSearch();

  // Show only the localized generic message; never reflect URL-supplied text.
  const oauthError = error ? m.auth_social_signin_error() : undefined;

  return <LoginForm redirectTo={redirect} oauthError={oauthError} />;
}
