import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchAdminSettings } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useAdminSettings() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.admin.settings(),
    queryFn: fetchAdminSettings,
  });
}
