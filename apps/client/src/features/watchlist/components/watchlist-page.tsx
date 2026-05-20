import { Suspense } from "react";
import { ErrorBoundary } from "@/shared/components/error-boundary";
import { WatchlistContent } from "./watchlist-content";
import { WatchlistErrorFallback } from "./watchlist-error-fallback";
import { WatchlistSkeleton } from "./watchlist-skeleton";

/**
 * Top-level entry. Wraps the live content in `<ErrorBoundary> > <Suspense>`
 * so the page can render before the fetch settles, and a server fault renders
 * the dedicated fallback instead of bubbling to the page-level boundary.
 */
export function WatchlistPage() {
  return (
    <ErrorBoundary
      fallback={({ error, reset }) => (
        <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />
      )}
    >
      <Suspense fallback={<WatchlistSkeleton />}>
        <WatchlistContent />
      </Suspense>
    </ErrorBoundary>
  );
}
