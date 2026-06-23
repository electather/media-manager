import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { authClient } from "@/shared/lib/auth";
import { completeOnboarding } from "../lib/fetchers";

/** Force session refetch with disableCookieCache so _authenticated guard sees new hasOnboarded flag. */
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
