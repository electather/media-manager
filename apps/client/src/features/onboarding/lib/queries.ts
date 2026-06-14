import { queryOptions } from "@tanstack/react-query";
import { fetchOnboardingState, fetchPublicConfig } from "./fetchers";
import { onboardingKeys } from "./query-keys";

/**
 * Public config query for the root route guard. `needsBootstrap` only ever
 * transitions true → false once per install and never back, so an effectively
 * immortal `staleTime` avoids a network call on every navigation.
 */
export function publicConfigQueryOptions() {
  return queryOptions({
    queryKey: onboardingKeys.publicConfig(),
    queryFn: fetchPublicConfig,
    staleTime: Number.POSITIVE_INFINITY,
  });
}

/** Onboarding state query driving the wizard's steps and the Finish gate. */
export function onboardingStateQueryOptions() {
  return queryOptions({
    queryKey: onboardingKeys.state(),
    queryFn: fetchOnboardingState,
  });
}
