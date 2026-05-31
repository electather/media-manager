import * as m from "@/paraglide/messages";
import type { LibraryFacetCounts, LibraryFilters, LibraryLens, LibraryStats } from "../lib/types";
import { LibraryFilterPopover } from "./library-filter-popover";
import { LibraryLensTabs } from "./library-lens-tabs";
import { LibrarySearch } from "./library-search";
import { LibraryStats as LibraryStatsSpine } from "./library-stats";

interface LibraryHeaderProps {
  stats: LibraryStats;
  lens: LibraryLens;
  onLensChange: (lens: LibraryLens) => void;
  query: string;
  onQueryChange: (query: string) => void;
  filters: LibraryFilters;
  onFiltersChange: (filters: LibraryFilters) => void;
  facetValues: { genres: string[]; qualities: string[]; servers: string[] };
  facetCounts: LibraryFacetCounts;
}

/**
 * The library header region: eyebrow + counted title, the stats spine, and the
 * control bar (lens tabs on the lead edge; search + filters on the trail edge).
 */
export function LibraryHeader({
  stats,
  lens,
  onLensChange,
  query,
  onQueryChange,
  filters,
  onFiltersChange,
  facetValues,
  facetCounts,
}: LibraryHeaderProps) {
  return (
    <header className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
          {m.library_eyebrow({ count: String(stats.total) })}
        </span>
        <h1 className="text-4xl font-bold tracking-tight text-foreground sm:text-5xl">
          {m.library_title()}
          <span className="ms-3 align-middle font-mono text-2xl font-medium tabular-nums text-muted-foreground/70">
            {stats.total}
          </span>
        </h1>
      </div>

      <LibraryStatsSpine stats={stats} />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <LibraryLensTabs value={lens} onChange={onLensChange} />
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1 lg:w-72 lg:flex-none">
            <LibrarySearch value={query} onChange={onQueryChange} />
          </div>
          <LibraryFilterPopover
            filters={filters}
            facetValues={facetValues}
            facetCounts={facetCounts}
            onChange={onFiltersChange}
          />
        </div>
      </div>
    </header>
  );
}
