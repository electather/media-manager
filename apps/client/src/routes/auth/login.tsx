import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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
  const navigate = Route.useNavigate();

  // Snapshot the error into local state so the banner stays visible after the
  // URL is cleaned. Deriving directly from Route.useSearch() would make it
  // disappear on the next render once the param is removed. Safe to snapshot at
  // mount because every OAuth failure arrives via a full-page server redirect
  // (HTTP 302 to errorCallbackURL), which remounts the app. If that ever
  // changes to SPA navigation, replace with a useEffect-driven setter.
  const [oauthError] = useState(error ? m.auth_social_signin_error() : undefined);

  useEffect(() => {
    if (!error) return;
    // Remove the ?error param from the URL without adding a history entry so
    // bookmarked or shared login URLs do not keep showing the banner and
    // back/forward navigation does not re-trigger it.
    void navigate({
      search: (prev) => ({ ...prev, error: undefined }),
      replace: true,
    });
  }, [error, navigate]);

  return <LoginForm redirectTo={redirect} oauthError={oauthError} />;
}
