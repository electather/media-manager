import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchAdminUsers } from "../lib/fetchers";
import { adminUsersKeys } from "../lib/query-keys";

export function useAdminUsers() {
  return useSuspenseQuery({
    queryKey: adminUsersKeys.list(),
    queryFn: fetchAdminUsers,
  });
}
