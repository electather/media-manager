import { Skeleton } from "@/shared/ui/skeleton";

interface WatchlistGridSkeletonProps {
  /** Visual rows × cols (default 4 × 3 = 12 placeholders). */
  rows?: number;
  cols?: number;
}

/**
 * Content-shaped Suspense fallback for the watchlist flat + mood grids
 * (V.WL10). Mirrors `VirtualGrid`'s `minColumnWidthPx={180}` and the
 * `WatchlistCard forceAspect="2/3"` placeholder shape so the loading skeleton
 * resembles the rendered grid instead of a generic block.
 */
export function WatchlistGridSkeleton({ rows = 4, cols = 3 }: WatchlistGridSkeletonProps = {}) {
  const count = Math.max(1, rows * cols);
  return (
    <div
      className="grid gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      aria-hidden="true"
      data-testid="watchlist-grid-skeleton"
    >
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} className="aspect-[2/3] w-full rounded-xl" />
      ))}
    </div>
  );
}
