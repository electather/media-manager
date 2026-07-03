import { useLibraryCollections } from "../../hooks/use-library-collections";
import { useLibraryFilters } from "../../hooks/use-library-filters";
import { CollectionsLens } from "./collections-lens";
import { LibraryEmpty } from "../library-empty";

/**
 * `/library/collections` — the curated-collections lens. Collections is
 * group-first server-side (its own `/api/library/collections` endpoint returns
 * `{ collections, cursor }`, not a media `Page`), so it does NOT route through
 * the shared `LensPage` item-lens guard — it owns its filters + Suspense
 * infinite read here and renders the empty state inline.
 */
export function CollectionsLensPage() {
  const { filters, resetFilters } = useLibraryFilters();
  const { collections, hasNextPage, isFetchingNextPage, fetchNextPage, error } =
    useLibraryCollections(filters);

  if (collections.length === 0) return <LibraryEmpty onReset={resetFilters} />;

  return (
    <CollectionsLens
      collections={collections}
      hasNextPage={hasNextPage}
      isFetchingNextPage={isFetchingNextPage}
      fetchNextPage={fetchNextPage}
      error={error}
    />
  );
}
