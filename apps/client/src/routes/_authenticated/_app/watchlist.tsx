import { createFileRoute, Outlet } from "@tanstack/react-router";

import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  errorComponent: WatchlistRouteError,
  component: () => (
    <ErrorBoundary>
      <WatchlistLayout>
        <Outlet />
      </WatchlistLayout>
    </ErrorBoundary>
  ),
});
