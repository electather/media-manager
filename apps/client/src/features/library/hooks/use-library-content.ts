import { useMemo } from "react";
import type { LibraryLens } from "@nama/shared/library";
import { toSectionEntries } from "../lib/section-groups";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryLens } from "./use-library-lens";

/** The four lenses that share the flat-item-stream shape (collections is group-first). */
type ItemLens = Exclude<LibraryLens, "collections">;

/**
 * Per-lens content hook for flat-item lenses; headers splice on group-key change.
 * One infinite query per mounted lens (not conditional call — rules-of-hooks safe).
 * Collections routed separately due to different response shape.
 */
export function useLibraryContent(lens: ItemLens) {
  const { filters, resetFilters } = useLibraryFilters();
  const { items, partial, hasNextPage, isFetchingNextPage, fetchNextPage, error } = useLibraryLens(
    lens,
    filters,
  );
  const entries = useMemo(() => toSectionEntries(items, lens), [items, lens]);
  return {
    entries,
    partial,
    isEmpty: items.length === 0,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    error,
    resetFilters,
  };
}
