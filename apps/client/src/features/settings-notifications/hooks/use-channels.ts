import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchChannels } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

export function useChannels() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.channels(),
    queryFn: fetchChannels,
  });
}
