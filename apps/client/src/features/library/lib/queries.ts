import { queryOptions } from "@tanstack/react-query";
import { fetchLibrary } from "./fetchers";
import { libraryKeys } from "./query-keys";

/** Suspense-ready query for the full library payload; prefetched by the route loader. */
export const libraryDataQueryOptions = () =>
  queryOptions({
    queryKey: libraryKeys.data(),
    queryFn: fetchLibrary,
    staleTime: 5 * 60 * 1000,
  });
