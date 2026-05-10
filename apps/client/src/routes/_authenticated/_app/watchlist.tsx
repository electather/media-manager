import { createFileRoute } from "@tanstack/react-router";

import { WatchlistPage } from "@/features/watchlist";
import { ErrorBoundary } from "@/shared/components/error-boundary";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  component: () => (
    <ErrorBoundary>
      <WatchlistPage />
    </ErrorBoundary>
  ),
});
