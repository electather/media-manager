import { createFileRoute, Outlet } from "@tanstack/react-router";

import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";

// Layout shell: render errors route to `errorComponent` (#513). Child flat/mood
// pages keep their own `<ErrorBoundary>` for post-mount section/query failures.
export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  errorComponent: WatchlistRouteError,
  component: () => (
    <WatchlistLayout>
      <Outlet />
    </WatchlistLayout>
  ),
});
