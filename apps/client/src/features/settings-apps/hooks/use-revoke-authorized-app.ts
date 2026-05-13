import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { revokeAuthorizedApp } from "../lib/fetchers";
import { settingsAppsKeys } from "../lib/query-keys";

export function useRevokeAuthorizedApp() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (clientId: string) => revokeAuthorizedApp(clientId),
    onMutate: async (clientId) => {
      await queryClient.cancelQueries({ queryKey: settingsAppsKeys.authorizedApps() });
      const previous = queryClient.getQueryData<AuthorizedApp[]>(settingsAppsKeys.authorizedApps());
      if (previous) {
        queryClient.setQueryData<AuthorizedApp[]>(
          settingsAppsKeys.authorizedApps(),
          previous.filter((app) => app.clientId !== clientId),
        );
      }
      return { previous };
    },
    onError: (_error, _clientId, context) => {
      if (context?.previous) {
        queryClient.setQueryData(settingsAppsKeys.authorizedApps(), context.previous);
      }
    },
    onSuccess: (apps) => {
      queryClient.setQueryData<AuthorizedApp[]>(settingsAppsKeys.authorizedApps(), apps);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsAppsKeys.authorizedApps() });
    },
  });
}
