import {
  type InfiniteData,
  type QueryClient,
  infiniteQueryOptions,
  useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import type { LibraryCollection, LibraryCollectionsResponse } from "@nama/shared/library";
import { fetchCollectionsPage } from "../lib/fetchers";
import { libraryKeys } from "../lib/query-keys";
import type { LibraryFilters } from "../lib/types";

// Module-level ref keeps `select` memoization stable across renders.
const selectCollections = (data: InfiniteData<LibraryCollectionsResponse>): LibraryCollection[] =>
  data.pages.flatMap((page) => page.collections);

// Custom endpoint (group-first), separate options + query key. Cursor threads as pageParam; null cursor ends pagination.
export function libraryCollectionsQueryOptions(filters: LibraryFilters) {
  return infiniteQueryOptions({
    queryKey: libraryKeys.collections(filters),
    queryFn: ({ pageParam }) => fetchCollectionsPage(filters, pageParam ?? null),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.cursor ?? undefined,
    select: selectCollections,
  });
}

/**
 * Loader-side warm for the Collections lens (skill rule 5). Threads the same
 * options the hook reads so the cache key matches and the suspense boundary
 * paints with data on first mount.
 */
export function prefetchLibraryCollections(
  queryClient: QueryClient,
  filters: LibraryFilters,
): Promise<unknown> {
  return queryClient.ensureInfiniteQueryData(libraryCollectionsQueryOptions(filters));
}

// Suspense + infinite-scroll; cards use `preview` posters (no nested fetch).
export function useLibraryCollections(filters: LibraryFilters) {
  const query = useSuspenseInfiniteQuery(libraryCollectionsQueryOptions(filters));
  return {
    collections: query.data,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}
