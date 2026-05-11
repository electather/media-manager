import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPublicConfig } from "../fetchers";
import { settingsKeys } from "../query-keys";

export function usePublicConfig() {
  return useSuspenseQuery({
    queryKey: settingsKeys.publicConfig(),
    queryFn: fetchPublicConfig,
    staleTime: Infinity,
  });
}
