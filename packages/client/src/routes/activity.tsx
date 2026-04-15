import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/activity")({
  component: ActivityPage,
});

function ActivityPage() {
  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">Activity</h1>
      <p className="text-muted-foreground">Watch history, watchlist, and upcoming episodes</p>
    </div>
  );
}
