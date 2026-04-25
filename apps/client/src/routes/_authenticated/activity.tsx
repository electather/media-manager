import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Activity</h1>
      <p className="text-muted-foreground">
        Read-only view of personal activity across services. Three tabs: Watch History (paginated
        Trakt history, filterable by movie/tv), Watchlist (Trakt watchlist with Seerr availability
        status), and Upcoming (calendar or list view of airing episodes for shows in progress).
      </p>
    </div>
  );
}
