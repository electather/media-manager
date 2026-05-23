import { useLocation } from "@tanstack/react-router";
import * as m from "@/paraglide/messages";
import {
  SectionHead,
  SectionHeadEyebrow,
  SectionHeadHeading,
  SectionHeadTitle,
} from "@/shared/components/section-head";
import type { WatchlistBucket, WatchlistCounts, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { WATCHLIST_BUCKETS } from "@ent-mcp/shared/watchlist";
import { useSearch } from "@tanstack/react-router";
import { BucketChips } from "./sections/all-items/bucket-chips";
import { SortSelect } from "./sections/all-items/sort-select";

interface WatchlistHeaderProps {
  counts: WatchlistCounts;
}

const FLAT_BUCKET_PATHS: ReadonlySet<string> = new Set(
  WATCHLIST_BUCKETS.map((b) => `/watchlist/${b}`),
);

/**
 * Shared page header for the `/watchlist/*` route family. Renders the
 * title, the chip strip (always visible), and the sort dropdown (only on
 * flat bucket sub-routes — curated `/watchlist` and `/watchlist/moods/:id`
 * hide it). State lives entirely in the URL (path + `?sort=`).
 */
export function WatchlistHeader({ counts }: WatchlistHeaderProps) {
  const location = useLocation();
  const showSort = FLAT_BUCKET_PATHS.has(location.pathname);
  return (
    <header>
      <SectionHead size="page">
        <SectionHeadHeading>
          <SectionHeadEyebrow size="page">{m.watchlist_eyebrow()}</SectionHeadEyebrow>
          <SectionHeadTitle as="h1" size="page">
            {m.watchlist_title()}
          </SectionHeadTitle>
        </SectionHeadHeading>
      </SectionHead>

      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-border pt-4 pb-6">
        <BucketChips counts={counts} />
        {showSort ? <FlatSortControl bucket={extractBucket(location.pathname)} /> : null}
      </div>
    </header>
  );
}

function extractBucket(pathname: string): WatchlistBucket {
  const segment = pathname.slice("/watchlist/".length);
  return segment as WatchlistBucket;
}

interface FlatSortControlProps {
  bucket: WatchlistBucket;
}

/**
 * Reads the current sub-route's `?sort=` so the dropdown reflects the URL.
 * `strict: false` lets the same component sit in the layout above all four
 * flat bucket routes without a per-route prop wire-up.
 */
function FlatSortControl({ bucket }: FlatSortControlProps) {
  const search = useSearch({ strict: false }) as { sort?: WatchlistSort };
  return (
    <label
      htmlFor={`watchlist-sort-${bucket}`}
      className="inline-flex items-center gap-2 font-mono text-xs uppercase tracking-[0.04em] text-muted-foreground"
    >
      <span>{m.watchlist_sort_label()}</span>
      <SortSelect value={search.sort ?? "recent"} />
    </label>
  );
}
