import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchCategories } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";

export function useCategories() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.categories(),
    queryFn: fetchCategories,
  });
}
