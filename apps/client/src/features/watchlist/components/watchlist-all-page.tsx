import { Suspense } from "react";
import { useSearch } from "@tanstack/react-router";
import type { MoodId, WatchlistBucket, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { useCounts } from "../hooks/use-counts";
import { AllItems } from "./sections/all-items";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";
import { WatchlistHeader } from "./watchlist-header";
import { WatchlistPeekModal } from "./watchlist-peek-modal";

interface AllSearch {
  sort?: WatchlistSort;
  bucket?: WatchlistBucket;
  mood?: MoodId;
  peek?: string;
}

/**
 * Flat `/watchlist/all` view. Reads sort/bucket/mood from search params,
 * passes them to `AllItems` which drives the paginated `useAllItems` hook.
 * Bucket chips + sort dropdown live in the header; both push search-param
 * updates instead of holding local state.
 */
export function WatchlistAllPage() {
  const search = useSearch({ strict: false }) as AllSearch;
  const sort = search.sort ?? "recent";
  const { data: counts } = useCounts();
  return (
    <main className="mx-auto w-full max-w-[100rem] px-4 sm:px-6 lg:px-8">
      <WatchlistHeader mode="flat" counts={counts} sort={sort} bucket={search.bucket} />
      <div className="pb-32">
        <ErrorBoundary
          fallback={({ error, reset }) => (
            <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />
          )}
        >
          <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
            <AllItems sort={sort} bucket={search.bucket} mood={search.mood} />
          </Suspense>
        </ErrorBoundary>
      </div>
      <WatchlistPeekModal />
    </main>
  );
}
