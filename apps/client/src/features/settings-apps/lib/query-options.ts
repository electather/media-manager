import { fetchAuthorizedApps, fetchPublicConfig } from "./fetchers";
import { settingsAppsKeys } from "./query-keys";

export function publicConfigQueryOptions() {
  return {
    queryKey: settingsAppsKeys.publicConfig(),
    queryFn: fetchPublicConfig,
    // Immortal, not the 60s default: public config is effectively static for the
    // session, so it never needs to refetch on navigation.
    staleTime: Infinity,
  };
}

export function authorizedAppsQueryOptions() {
  return {
    queryKey: settingsAppsKeys.authorizedApps(),
    queryFn: fetchAuthorizedApps,
  };
}

export function settingsAppsPageQueryOptions() {
  return [publicConfigQueryOptions(), authorizedAppsQueryOptions()] as const;
}
