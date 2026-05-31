import { Suspense, useCallback, useState } from "react";
import { useLibrary } from "../hooks/use-library";
import { useLibraryView } from "../hooks/use-library-view";
import type { LibraryCollection, LibraryItem } from "../lib/types";
import { EMPTY_FILTERS, type LibraryFilters, type LibraryLens } from "../lib/types";
import { LibraryEmpty } from "./library-empty";
import { LibraryHeader } from "./library-header";
import { LibrarySkeleton } from "./library-skeleton";
import { AzLens } from "./lenses/az-lens";
import { CollectionsLens } from "./lenses/collections-lens";
import { QualityLens } from "./lenses/quality-lens";
import { ServersLens } from "./lenses/servers-lens";
import { TimelineLens } from "./lenses/timeline-lens";

interface LensViewProps {
  lens: LibraryLens;
  items: LibraryItem[];
  collections: LibraryCollection[];
}

/** Routes the active lens to its view, grouping the same filtered item set. */
function LensView({ lens, items, collections }: LensViewProps) {
  switch (lens) {
    case "timeline":
      return <TimelineLens items={items} />;
    case "collections":
      return <CollectionsLens items={items} collections={collections} />;
    case "server":
      return <ServersLens items={items} />;
    case "quality":
      return <QualityLens items={items} />;
    case "az":
      return <AzLens items={items} />;
  }
}

/**
 * Library entry point. The route loader prefetches `libraryDataQueryOptions`
 * and supplies the loader-pending skeleton; this inner `<Suspense>` covers
 * revalidation / cache-miss windows while the data flows through
 * `useSuspenseQuery` (skill rule 5).
 */
export function LibraryPage() {
  return (
    <Suspense fallback={<LibrarySkeleton />}>
      <LibraryReady />
    </Suspense>
  );
}

function LibraryReady() {
  const { data } = useLibrary();
  // URL/UI state lives on the page; children consume it via props (skill rule 8).
  const [lens, setLens] = useState<LibraryLens>("az");
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<LibraryFilters>(EMPTY_FILTERS);

  const { filtered, stats, facetValues, facetCounts } = useLibraryView({ data, query, filters });

  const handleReset = useCallback(() => {
    setQuery("");
    setFilters(EMPTY_FILTERS);
  }, []);

  return (
    <div className="mx-auto flex w-full max-w-400 flex-col gap-8 px-4 pb-32 sm:px-6 lg:px-8">
      <LibraryHeader
        stats={stats}
        lens={lens}
        onLensChange={setLens}
        query={query}
        onQueryChange={setQuery}
        filters={filters}
        onFiltersChange={setFilters}
        facetValues={facetValues}
        facetCounts={facetCounts}
      />
      {filtered.length === 0 ? (
        <LibraryEmpty onReset={handleReset} />
      ) : (
        <LensView lens={lens} items={filtered} collections={data.collections} />
      )}
    </div>
  );
}
