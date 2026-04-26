import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/_app/")({
  component: HomePage,
});

function HomePage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Home</h1>
      <p className="text-muted-foreground">
        Overview page. Shows connection status cards (one per service), recent Trakt watch history
        feed, upcoming episodes for in-progress shows, active Seerr download requests, and a taste
        profile summary with top genres and top directors/actors.
      </p>
    </div>
  );
}
