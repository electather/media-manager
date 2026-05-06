import { useQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

const EMPTY_FILTERS: InboxFilters = {};

export function usePopoverInbox(open: boolean, filters: InboxFilters = EMPTY_FILTERS) {
  return useQuery({
    enabled: open,
    queryKey: notificationsKeys.inbox(filters),
    queryFn: () => fetchInboxPage(filters, null),
    staleTime: 30_000,
  });
}
