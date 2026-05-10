import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { authClient } from "@/shared/lib/auth";
import { settingsKeys } from "../query-keys";

/**
 * Better Auth session shape, narrowed to the fields the security tab reads.
 * The full type lives in `better-auth/types`; we keep this local one to
 * decouple the UI from upstream churn.
 */
export interface AuthSession {
  id: string;
  token: string;
  userId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  expiresAt: Date | string;
}

async function fetchSessions(): Promise<AuthSession[]> {
  const result = await authClient.listSessions();
  if (result.error) throw new Error(result.error.message ?? "Failed to load sessions");
  return (result.data ?? []) as AuthSession[];
}

export function useSessions(): UseQueryResult<AuthSession[]> {
  return useQuery({
    queryKey: settingsKeys.sessions(),
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
    mutationFn: async (token: string) => {
      const result = await authClient.revokeSession({ token });
      if (result.error) throw new Error(result.error.message ?? "Revoke failed");
    },
    onMutate: async (token) => {
      await qc.cancelQueries({ queryKey: settingsKeys.sessions() });
      const prev = qc.getQueryData<AuthSession[]>(settingsKeys.sessions());
      if (prev) {
        qc.setQueryData<AuthSession[]>(
          settingsKeys.sessions(),
          prev.filter((s) => s.token !== token),
        );
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(settingsKeys.sessions(), ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.sessions() });
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
    mutationFn: async () => {
      const result = await authClient.revokeOtherSessions();
      if (result.error) throw new Error(result.error.message ?? "Revoke failed");
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: settingsKeys.sessions() });
    },
  });
}
