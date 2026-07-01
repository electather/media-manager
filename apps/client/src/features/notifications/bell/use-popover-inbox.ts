import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

const EMPTY_FILTERS: InboxFilters = {};

export function usePopoverInbox(filters: InboxFilters = EMPTY_FILTERS) {
  return useSuspenseQuery({
    queryKey: notificationsKeys.popoverInbox(filters),
    queryFn: () => fetchInboxPage(filters, null),
    // 30s (tighter than the 60s app default): the bell should show recent
    // deliveries promptly on reopen while still serving cache for rapid re-opens.
    staleTime: 30_000,
  });
}
