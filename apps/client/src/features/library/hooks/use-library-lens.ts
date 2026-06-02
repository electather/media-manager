import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { LibraryLens } from "@ent-mcp/shared/library";
import { prefetchMediaRows, useMediaRows } from "@/shared/media/use-media-rows";
import { defineLensSource } from "../lib/fetchers";
import type { LibraryFilters } from "../lib/types";

/** The lens that has its own endpoint (collections), excluded from the media source path. */
type ItemLens = Exclude<LibraryLens, "collections">;

/**
 * Loader-side warm for an item lens (skill rule 5: loaders warm Suspense reads).
 * Threads the SAME `defineLensSource` the hook reads, so the cache key matches
 * and the suspense boundary paints with data on first mount instead of a
 * fallback. The route loader reads the active filters off the URL search and
 * passes them here.
 */
export function prefetchLibraryLens(
  queryClient: QueryClient,
  lens: ItemLens,
  filters: LibraryFilters,
): Promise<unknown> {
  return prefetchMediaRows(queryClient, defineLensSource(lens, filters));
}

/**
 * The Suspense infinite read for one item lens (skill rule 5: primary lens reads
 * are `useSuspenseInfiniteQuery`). It REUSES the shared media-source infinite
 * hook home + watchlist read through (`useMediaRows` → `mediaRowsQueryOptions`)
 * rather than reinventing cursor threading / flatten / cache keying — the four
 * item lenses are just media sources (`library-<lens>`) parameterized by the
 * active filters. One hook, one query (rule 7).
 *
 * The source descriptor is memoed on `lens + filters` so the same filter combo
 * reuses one `ClientMediaSource` reference (and so one stable query key); a
 * filter change mints a new source and the shared hook keys a fresh cache entry.
 * Returns the flat sorted `items` stream plus the infinite-scroll controls the
 * `VirtualGrid` consumes — the page inserts section headers off this flat stream
 * via `toSectionEntries`.
 */
export function useLibraryLens(lens: ItemLens, filters: LibraryFilters) {
  const source = useMemo(() => defineLensSource(lens, filters), [lens, filters]);
  return useMediaRows(source);
}
