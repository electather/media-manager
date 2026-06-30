import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchInboxPage } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";
import type { InboxFilters } from "../shared/types";

const EMPTY_FILTERS: InboxFilters = {};

export function usePopoverInbox(filters: InboxFilters = EMPTY_FILTERS) {
  return useSuspenseQuery({
    queryKey: notificationsKeys.popoverInbox(filters),
    queryFn: () => fetchInboxPage(filters, null),
  });
}
