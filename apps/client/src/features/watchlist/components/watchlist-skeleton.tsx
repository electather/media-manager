import { Skeleton } from "@/shared/ui/skeleton";

/**
 * Fallback for the `<Suspense>` boundary that wraps `WatchlistContent`. Mirrors
 * the rough header + tonight pick + two scroll rows shape of the live page so
 * the layout does not jump on first paint.
 */
export function WatchlistSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8"
      data-testid="watchlist-skeleton"
    >
      <div className="mb-12 flex flex-col gap-3 pt-4">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-56" />
      </div>
      <div className="mb-14 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(280px,360px)]">
        <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
        <Skeleton className="h-full min-h-[200px] w-full rounded-2xl" />
      </div>
      <div className="mb-14 flex gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[2/3] w-[200px] shrink-0 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
