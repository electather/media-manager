import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/watchlist")({
  component: WatchlistRoute,
});

function WatchlistRoute() {
  return <div>Watchlist coming soon</div>;
}
