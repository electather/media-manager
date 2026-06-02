import { useSuspenseQuery } from "@tanstack/react-query";
import { libraryDataQueryOptions } from "../lib/queries";

/** Primary library read (skill rule 5: Suspense). The route prefetches the same query. */
export function useLibrary() {
  return useSuspenseQuery(libraryDataQueryOptions());
}
