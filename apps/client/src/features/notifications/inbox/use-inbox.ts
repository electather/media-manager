import { useSuspenseInfiniteQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

export function useInbox(filters: InboxFilters) {
  return useSuspenseInfiniteQuery({
    queryKey: notificationsKeys.inbox(filters),
    queryFn: ({ pageParam }) => fetchInboxPage(filters, pageParam ?? null),
    initialPageParam: null as string | null,
    getNextPageParam: (last) =>
      "nextCursor" in last && typeof last.nextCursor === "string" ? last.nextCursor : null,
    // Live inbox; polling does not invalidate on receive, so refetch on mount.
    staleTime: 0,
  });
}
