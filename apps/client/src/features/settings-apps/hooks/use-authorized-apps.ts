import { useSuspenseQuery } from "@tanstack/react-query";

import { authorizedAppsQueryOptions } from "../lib/query-options";

export function useAuthorizedApps() {
  return useSuspenseQuery(authorizedAppsQueryOptions());
}
