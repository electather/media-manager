import { useSuspenseQuery } from "@tanstack/react-query";

import { publicConfigQueryOptions } from "../lib/query-options";

export function usePublicConfig() {
  return useSuspenseQuery(publicConfigQueryOptions());
}
