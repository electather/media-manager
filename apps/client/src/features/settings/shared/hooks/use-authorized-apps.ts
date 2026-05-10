import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import type { AuthorizedApp } from "@ent-mcp/shared/users";
import { fetchAuthorizedApps, revokeAuthorizedApp } from "../fetchers";
import { settingsKeys } from "../query-keys";

export function useAuthorizedApps() {
  return useSuspenseQuery({
    queryKey: settingsKeys.apps(),
    queryFn: fetchAuthorizedApps,
  });
}

/**
 * Optimistic revoke: drops the row from the cached list immediately, then
 * seeds the cache from the server's authoritative `body.apps` payload on
 * success (no extra refetch round-trip). Rolls back on error.
 */
export function useRevokeAuthorizedApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (clientId: string) => revokeAuthorizedApp(clientId),
    onMutate: async (clientId) => {
      await qc.cancelQueries({ queryKey: settingsKeys.apps() });
      const prev = qc.getQueryData<AuthorizedApp[]>(settingsKeys.apps());
      if (prev) {
        qc.setQueryData<AuthorizedApp[]>(
          settingsKeys.apps(),
          prev.filter((a) => a.clientId !== clientId),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(settingsKeys.apps(), ctx.prev);
    },
    onSuccess: (apps) => {
      qc.setQueryData<AuthorizedApp[]>(settingsKeys.apps(), apps);
    },
  });
}
