import { createFileRoute } from "@tanstack/react-router";
import { Suspense } from "react";
import { WatchlistPage, WatchlistSkeleton } from "@/features/watchlist";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  pendingComponent: WatchlistSkeleton,
  component: WatchlistRoute,
});

function WatchlistRoute() {
  return (
    <Suspense fallback={<WatchlistSkeleton />}>
      <WatchlistPage />
    </Suspense>
  );
}
