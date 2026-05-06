import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchChannels } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useChannels() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.channels(),
    queryFn: fetchChannels,
  });
}
