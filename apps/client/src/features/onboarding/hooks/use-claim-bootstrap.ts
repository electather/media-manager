import { useMutation, useQueryClient } from "@tanstack/react-query";
import { claimBootstrap } from "../lib/fetchers";
import { onboardingKeys } from "../lib/query-keys";

/** Creates the first administrator from the one-time setup token. */
export function useClaimBootstrap() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: claimBootstrap,
    onSuccess: async () => {
      // The claim just created the first user, so `needsBootstrap` is now false.
      // The root and /bootstrap guards cached the pre-claim `true` with an
      // immortal `staleTime`; without invalidating it here the next guard read
      // (on navigation to /setup) would still see `true` and bounce the new admin
      // back to /bootstrap until a full page reload. Invalidating before the
      // caller navigates forces that read to refetch the now-false config.
      await queryClient.invalidateQueries({ queryKey: onboardingKeys.publicConfig() });
    },
  });
}
