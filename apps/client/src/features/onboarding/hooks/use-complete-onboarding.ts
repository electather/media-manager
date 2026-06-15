import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";
import { completeOnboarding } from "../lib/fetchers";

/**
 * Flips `hasOnboarded` server-side, then refreshes the session so the
 * `_authenticated` guard reads the new flag and stops redirecting back to
 * `/setup`. Better Auth caches the session behind a cookie, so we force a
 * refetch with `disableCookieCache` before navigating to the app.
 */
export function useCompleteOnboarding() {
  const navigate = useNavigate();
  return useMutation({
    mutationFn: completeOnboarding,
    onSuccess: async () => {
      await authClient.getSession({ query: { disableCookieCache: true } });
      void navigate({ to: "/" });
    },
  });
}

/** The mutation object returned by {@link useCompleteOnboarding}. */
export type CompleteOnboardingMutation = ReturnType<typeof useCompleteOnboarding>;
