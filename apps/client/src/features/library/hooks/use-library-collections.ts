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

/**
 * Flatten the loaded collection pages into one list. A module-level reference
 * keeps React Query's `select` memoization stable (re-runs only when the page
 * set changes, not every render), mirroring the shared media hook's
 * `selectMediaRows`.
 */
const selectCollections = (data: InfiniteData<LibraryCollectionsResponse>): LibraryCollection[] =>
  data.pages.flatMap((page) => page.collections);

/**
 * Infinite-query options for the Collections lens. Unlike the four item lenses,
 * collections is group-first server-side (its own `/api/library/collections`
 * endpoint returns `{ collections, cursor }`, not a media `Page`), so it does
 * not flow through the shared media source — it gets its own options keyed by
 * `libraryKeys.collections(filters)` (filters in the key, rule 4). The opaque
 * `cursor` threads as `pageParam`; a null response cursor ends the set.
 */
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

/**
 * The Suspense infinite read for the Collections lens (skill rule 5: primary
 * lens reads suspend). Returns the flat `collections` list plus the
 * infinite-scroll controls the `VirtualGrid` consumes. One hook, one query
 * (rule 7). The cards fan each collection's `preview` posters directly (no
 * second fetch) — no client-side section headers here (the endpoint is
 * group-first).
 */
export function useLibraryCollections(filters: LibraryFilters) {
  const query = useSuspenseInfiniteQuery(libraryCollectionsQueryOptions(filters));
  return {
    collections: query.data,
    hasNextPage: query.hasNextPage,
    isFetchingNextPage: query.isFetchingNextPage,
    fetchNextPage: query.fetchNextPage,
  };
}
