import { createFileRoute, Outlet } from "@tanstack/react-router";

import { fetchCounts } from "@/shared/media/aggregates";
import { watchlistKeys } from "@/features/watchlist/lib/query-keys";
import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: watchlistKeys.counts(),
      queryFn: fetchCounts,
    }),
  errorComponent: WatchlistRouteError,
  component: () => (
    <ErrorBoundary>
      <WatchlistLayout>
        <Outlet />
      </WatchlistLayout>
    </ErrorBoundary>
  ),
});
