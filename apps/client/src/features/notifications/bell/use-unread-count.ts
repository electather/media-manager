import { useQuery } from "@tanstack/react-query";
import { fetchUnreadCount } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useUnreadCount() {
  return useQuery({
    queryKey: notificationsKeys.unreadCount(),
    queryFn: fetchUnreadCount,
    // Poll every 30 seconds so the nav badge stays fresh without making inbox
    // delivery feel like a foreground workflow.
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    networkMode: "online",
    staleTime: 15_000,
  });
}
