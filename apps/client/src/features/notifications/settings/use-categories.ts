import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchCategories } from "../shared/fetchers";
import { notificationsKeys } from "../shared/query-keys";

export function useCategories() {
  return useSuspenseQuery({
    queryKey: notificationsKeys.categories(),
    queryFn: fetchCategories,
  });
}
