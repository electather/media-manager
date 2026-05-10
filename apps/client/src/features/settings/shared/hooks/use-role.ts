import { useSuspenseQuery } from "@tanstack/react-query";
import { fetchRole } from "../fetchers";
import { settingsKeys } from "../query-keys";

export function useRole() {
  return useSuspenseQuery({
    queryKey: settingsKeys.role(),
    queryFn: fetchRole,
  });
}
