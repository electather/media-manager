import { createFileRoute, useNavigate } from "@tanstack/react-router";
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
  const navigate = useNavigate();

  // Snapshot the error into state on first render so the banner remains visible
  // after the URL param is removed. Without this snapshot, oauthError would be
  // re-derived as undefined on the next render triggered by the navigate() call.
  const [oauthError] = useState(() => (error ? m.auth_social_signin_error() : undefined));

  // Replace the URL to drop the ?error= param once we have snapshotted the value.
  // Using replace:true means the error URL never appears in browser history, so
  // bookmarking or pressing Back cannot re-surface a stale banner.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally runs once on mount
  useEffect(() => {
    if (error) {
      void navigate({ search: (prev) => ({ ...prev, error: undefined }), replace: true });
    }
  }, []);

  return <LoginForm redirectTo={redirect} oauthError={oauthError} />;
}
