import { useQueryClient } from "@tanstack/react-query";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { revokeAuthorizedApp } from "../lib/fetchers";
import { settingsAppsKeys } from "../lib/query-keys";

export function useRevokeAuthorizedApp() {
  const queryClient = useQueryClient();
  return useOptimisticArrayMutation<AuthorizedApp, string, AuthorizedApp[]>({
    queryKey: settingsAppsKeys.authorizedApps(),
    mutationFn: revokeAuthorizedApp,
    update: (prev, clientId) => prev.filter((app) => app.clientId !== clientId),
    onSuccess: (apps) => {
      queryClient.setQueryData<AuthorizedApp[]>(settingsAppsKeys.authorizedApps(), apps);
    },
  });
}
