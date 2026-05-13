import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import { fetchRevokeOtherSessions, fetchRevokeSession, fetchSessions } from "../lib/fetchers";
import { settingsSecurityKeys } from "../lib/query-keys";
import type { AuthSession } from "../lib/types";
export type { AuthSession } from "../lib/types";

export function useSessions(): UseSuspenseQueryResult<AuthSession[]> {
  return useSuspenseQuery({
    queryKey: settingsSecurityKeys.sessions(),
    queryFn: fetchSessions,
    staleTime: 30_000,
  });
}

/**
 * Optimistic single-session revoke. Removes the row from the cache before the
 * server replies; rolls back on error. The current session token is never
 * revoked from this hook — the row is hidden in the UI so the option never
 * surfaces.
 */
export function useRevokeSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchRevokeSession,
    onMutate: async (token) => {
      await qc.cancelQueries({ queryKey: settingsSecurityKeys.sessions() });
      const prev = qc.getQueryData<AuthSession[]>(settingsSecurityKeys.sessions());
      if (prev) {
        qc.setQueryData<AuthSession[]>(
          settingsSecurityKeys.sessions(),
          prev.filter((s) => s.token !== token),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(settingsSecurityKeys.sessions(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsSecurityKeys.sessions() });
    },
  });
}

/**
 * Revoke every session except the caller's. Better Auth handles "current
 * session" detection server-side, so we just call the endpoint and refetch.
 */
export function useRevokeOtherSessions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fetchRevokeOtherSessions,
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsSecurityKeys.sessions() });
    },
  });
}
