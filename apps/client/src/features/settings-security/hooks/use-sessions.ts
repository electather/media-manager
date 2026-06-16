import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
  type UseSuspenseQueryResult,
} from "@tanstack/react-query";
import { useOptimisticArrayMutation } from "@/shared/hooks/use-optimistic-array-mutation";
import { fetchRevokeOtherSessions, fetchRevokeSession, fetchSessions } from "../lib/fetchers";
import { settingsSecurityKeys } from "../lib/query-keys";
import type { AuthSession } from "../lib/types";

export function useSessions(): UseSuspenseQueryResult<AuthSession[]> {
  return useSuspenseQuery({
    queryKey: settingsSecurityKeys.sessions(),
    queryFn: fetchSessions,
    // Shorter than the 60s default: a security surface where a just-revoked
    // session should drop off the list promptly when the page is revisited.
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
  return useOptimisticArrayMutation<AuthSession, string>({
    queryKey: settingsSecurityKeys.sessions(),
    mutationFn: fetchRevokeSession,
    update: (prev, token) => prev.filter((s) => s.token !== token),
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
