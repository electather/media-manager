import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchInvites } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";

/** Suspense-reads the list of non-revoked admin invites. */
export function useAdminInvites() {
  return useSuspenseQuery({
    queryKey: adminInvitesKeys.list(),
    queryFn: fetchInvites,
  });
}
