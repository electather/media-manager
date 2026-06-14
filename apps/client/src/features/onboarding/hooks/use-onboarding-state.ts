import { useSuspenseQuery } from "@tanstack/react-query";
import { onboardingStateQueryOptions } from "../lib/queries";

/** Suspense read of the server-resolved onboarding state for the wizard. */
export function useOnboardingState() {
  return useSuspenseQuery(onboardingStateQueryOptions());
}
