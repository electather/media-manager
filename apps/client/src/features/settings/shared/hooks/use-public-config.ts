import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPublicConfig } from "../fetchers";
import { settingsKeys } from "../query-keys";

export function usePublicConfig() {
  return useSuspenseQuery({
    queryKey: settingsKeys.publicConfig(),
    queryFn: fetchPublicConfig,
    // Immortal, not the 60s default: public config is effectively static for the
    // session, so it never needs to refetch on navigation.
    staleTime: Infinity,
  });
}
