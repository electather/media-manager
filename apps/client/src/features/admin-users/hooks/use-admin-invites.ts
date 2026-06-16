import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchInvites } from "../lib/fetchers";
import { adminInvitesKeys } from "../lib/query-keys";

export function useAdminInvites() {
  return useSuspenseQuery({
    queryKey: adminInvitesKeys.list(),
    queryFn: fetchInvites,
  });
}
