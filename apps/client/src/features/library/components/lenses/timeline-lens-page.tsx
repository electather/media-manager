import { useLibraryFacets } from "../../hooks/use-library-facets";
import { LensPage } from "./lens-page";
import { TimelineLens } from "./timeline-lens";

/** `/library/timeline` — the release-decade lens. */
export function TimelineLensPage() {
  // The present-only decade set comes from the non-blocking facets read (rule
  // 5: facets never suspend), so the jump rail paints its live decades
  // independent of which pages of the infinite stream have loaded.
  const { facetCounts } = useLibraryFacets();
  const decades = facetCounts?.decades ?? [];
  return (
    <LensPage
      lens="timeline"
      render={({ entries, hasNextPage, isFetchingNextPage, fetchNextPage, error }) => (
        <TimelineLens
          decades={decades}
          entries={entries}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          fetchNextPage={fetchNextPage}
          error={error}
        />
      )}
    />
  );
}
