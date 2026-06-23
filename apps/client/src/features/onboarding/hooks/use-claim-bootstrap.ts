import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimBootstrap } from "../lib/fetchers";
import { onboardingKeys } from "../lib/query-keys";

/** Creates the first administrator from the one-time setup token. */
export function useClaimBootstrap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimBootstrap,
    onSuccess: async () => {
      // Invalidate pre-claim config cache (guards use immortal `staleTime`); otherwise next read would still see `needsBootstrap: true` and bounce user back to /bootstrap.
      await queryClient.invalidateQueries({ queryKey: onboardingKeys.publicConfig() });
    },
  });
}
