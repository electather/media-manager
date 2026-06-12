import { useMemo } from "react";
import type { LibraryLens } from "@nama/shared/library";
import { toSectionEntries } from "../lib/section-groups";
import { useLibraryFilters } from "./use-library-filters";
import { useLibraryLens } from "./use-library-lens";

/** The four lenses that share the flat-item-stream shape (collections is group-first). */
type ItemLens = Exclude<LibraryLens, "collections">;

/**
 * The per-lens content seam every item lens page (`az`/`timeline`/`server`/
 * `quality`) mounts on. It composes the URL filters, the Suspense infinite read
 * for THIS lens, and the section-header insertion into the single thing the lens
 * presenter renders: a flat `entries` list (headers spliced in on group-key
 * change) plus the infinite-scroll controls the `VirtualGrid` consumes and the
 * reset handler the empty state calls.
 *
 * The lens is fixed per route (each `*-lens-page` renders exactly one), so it is
 * not a conditional hook call — the rules-of-hooks-safe way to keep one infinite
 * query per mounted lens (rule 7) rather than reading all five at once. The
 * `entries` projection is memoed off the flat `items` stream so headers re-splice
 * only when the loaded page set changes, not on every render.
 *
 * Collections is intentionally NOT routed here — it has a different response
 * shape (`{ collections }`, group-first) and its own `useLibraryCollections`.
 */
export function useLibraryContent(lens: ItemLens) {
  const { filters, resetFilters } = useLibraryFilters();
  const { items, partial, hasNextPage, isFetchingNextPage, fetchNextPage } = useLibraryLens(
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
    resetFilters,
  };
}
