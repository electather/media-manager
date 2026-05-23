import { createFileRoute, Outlet } from "@tanstack/react-router";

import { fetchCounts } from "@/features/watchlist/lib/fetchers";
import { watchlistKeys } from "@/features/watchlist/lib/query-keys";
import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: watchlistKeys.counts(),
      queryFn: fetchCounts,
    }),
  component: () => (
    <ErrorBoundary>
      <WatchlistLayout>
        <Outlet />
      </WatchlistLayout>
    </ErrorBoundary>
  ),
});
