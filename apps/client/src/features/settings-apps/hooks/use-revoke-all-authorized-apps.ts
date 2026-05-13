import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AuthorizedApp } from "@ent-mcp/shared/users";

import { revokeAuthorizedApp } from "../lib/fetchers";
import { settingsAppsKeys } from "../lib/query-keys";

export interface RevokeAllAuthorizedAppsResult {
  count: number;
  failed: number;
}

export function useRevokeAllAuthorizedApps() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      apps: ReadonlyArray<AuthorizedApp>,
    ): Promise<RevokeAllAuthorizedAppsResult> => {
      const results = await Promise.allSettled(
        apps.map((app) => revokeAuthorizedApp(app.clientId)),
      );
      const failed = results.filter((result) => result.status === "rejected").length;
      return { count: apps.length, failed };
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: settingsAppsKeys.authorizedApps() });
    },
  });
}
