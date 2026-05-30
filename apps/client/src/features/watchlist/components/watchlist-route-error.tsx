import type { ErrorComponentProps } from "@tanstack/react-router";

import { WatchlistErrorFallback } from "./watchlist-error-fallback";

/**
 * Route-level `errorComponent` for the watchlist routes (design §B4, #513). When
 * a loader's first-page prefetch rejects, TanStack Router renders this instead of
 * the section — the component never mounts, so there is no inner ErrorBoundary to
 * catch it. It reuses the shared `WatchlistErrorFallback`; `reset` re-runs the
 * route loader (after the fallback's retry clears the cached failure) so the
 * prefetch is attempted again.
 */
export function WatchlistRouteError({ error, reset }: ErrorComponentProps) {
  return <WatchlistErrorFallback error={error} resetErrorBoundary={reset} />;
}
