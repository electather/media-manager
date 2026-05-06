import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchPlugins } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function usePlugins() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.plugins(),
    queryFn: fetchPlugins,
  });
}
