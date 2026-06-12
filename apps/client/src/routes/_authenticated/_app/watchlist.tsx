import { createFileRoute, Outlet } from "@tanstack/react-router";

import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  errorComponent: WatchlistRouteError,
  component: () => (
    <WatchlistLayout>
      <Outlet />
    </WatchlistLayout>
  ),
});
