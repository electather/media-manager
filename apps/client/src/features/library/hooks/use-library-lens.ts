import { useMemo } from "react";
import type { QueryClient } from "@tanstack/react-query";
import type { LibraryLens } from "@nama/shared/library";
import { prefetchMediaRows, useMediaRows } from "@/shared/media/use-media-rows";
import { defineLensSource } from "../lib/fetchers";
import type { LibraryFilters } from "../lib/types";

/** The lens that has its own endpoint (collections), excluded from the media source path. */
type ItemLens = Exclude<LibraryLens, "collections">;

// Prefetch with same defineLensSource so cache key matches hook read (avoids fallback on mount).
export function prefetchLibraryLens(
  queryClient: QueryClient,
  lens: ItemLens,
  filters: LibraryFilters,
): Promise<unknown> {
  return prefetchMediaRows(queryClient, defineLensSource(lens, filters));
}

// Suspense infinite query via useMediaRows; source is memoized on lens+filters for stable cache keys.
export function useLibraryLens(lens: ItemLens, filters: LibraryFilters) {
  const source = useMemo(() => defineLensSource(lens, filters), [lens, filters]);
  return useMediaRows(source);
}
