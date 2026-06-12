import { createFileRoute, Outlet } from "@tanstack/react-router";

import { WatchlistLayout } from "@/features/watchlist/components/watchlist-layout";
import { WatchlistRouteError } from "@/features/watchlist/components/watchlist-route-error";

// `WatchlistLayout` is a thin shell (header + peek modal), so its render errors
// route to `errorComponent` (#513) rather than an in-component `<ErrorBoundary>`.
// This intentionally trades the old full-page `ErrorPage` + `reportError()` for
// the route convention; the child flat/mood pages keep their own boundaries for
// post-mount section/query failures.
export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  errorComponent: WatchlistRouteError,
  component: () => (
    <WatchlistLayout>
      <Outlet />
    </WatchlistLayout>
  ),
});
