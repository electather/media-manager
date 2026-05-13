import { fetchAuthorizedApps, fetchPublicConfig } from "./fetchers";
import { settingsAppsKeys } from "./query-keys";

export function publicConfigQueryOptions() {
  return {
    queryKey: settingsAppsKeys.publicConfig(),
    queryFn: fetchPublicConfig,
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
