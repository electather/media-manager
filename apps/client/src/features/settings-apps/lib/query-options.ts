import { fetchPublicConfig, settingsKeys } from "@/features/settings";

import { fetchAuthorizedApps } from "./fetchers";
import { settingsAppsKeys } from "./query-keys";

// Uses the canonical settings key so both the Profile tab and the Apps tab
// read public config from a single shared cache entry.
export function publicConfigQueryOptions() {
  return {
    queryKey: settingsKeys.publicConfig(),
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
