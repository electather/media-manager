import { useMutation, useQueryClient } from "@tanstack/react-query";
import { saveTmdbKey } from "../lib/fetchers";
import { onboardingKeys } from "../lib/query-keys";

/**
 * Persists the TMDB API key and invalidates the onboarding state so the
 * wizard re-reads the required-step gate. Cache invalidation lives here so
 * the component never needs to import the query-keys factory directly.
 */
export function useSaveTmdbKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveTmdbKey,
    onSuccess: () => qc.invalidateQueries({ queryKey: onboardingKeys.state() }),
  });
}
