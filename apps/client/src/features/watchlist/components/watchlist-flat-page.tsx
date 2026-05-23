import { Suspense } from "react";
import { useSearch } from "@tanstack/react-router";
import type { WatchlistBucket, WatchlistSort } from "@ent-mcp/shared/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { Skeleton } from "@/shared/ui/skeleton";
import { AllItems } from "./sections/all-items";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";

interface FlatSearch {
  sort?: WatchlistSort;
  peek?: string;
}

interface WatchlistFlatPageProps {
  bucket: WatchlistBucket;
}

/**
 * Flat `/watchlist/<bucket>` content. Bucket comes from the route file;
 * sort is the only mutable search param. Header + peek modal live in the
 * layout route, so this page is just the grid + its Suspense boundary.
 */
export function WatchlistFlatPage({ bucket }: WatchlistFlatPageProps) {
  const search = useSearch({ strict: false }) as FlatSearch;
  const sort = search.sort ?? "recent";
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />
      )}
    >
      <Suspense fallback={<Skeleton className="h-[600px] w-full rounded-2xl" />}>
        <AllItems sort={sort} bucket={bucket} />
      </Suspense>
    </ErrorBoundary>
  );
}
