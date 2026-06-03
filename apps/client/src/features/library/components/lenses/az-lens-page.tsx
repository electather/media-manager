import { useLibraryFacets } from "../../hooks/use-library-facets";
import { AzLens } from "./az-lens";
import { LensPage } from "./lens-page";

/** `/library` (index) — the alphabetical index lens. */
export function AzLensPage() {
  // The present-only letter set comes from the non-blocking facets read (rule
  // 5: facets never suspend), so the rail paints its live letters independent of
  // which pages of the infinite stream have loaded.
  const { facetCounts } = useLibraryFacets();
  const letters = facetCounts?.letters ?? [];
  return (
    <LensPage
      lens="az"
      render={({ entries, hasNextPage, isFetchingNextPage, fetchNextPage }) => (
        <AzLens
          letters={letters}
          entries={entries}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
        />
      )}
    />
  );
}
