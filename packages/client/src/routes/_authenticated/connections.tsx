import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/connections")({
  component: ConnectionsPage,
});

function ConnectionsPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Connections</h1>
      <p className="text-muted-foreground">
        Manage service integrations. Grid of available integrations (Trakt, Seerr, TMDB, TVDB) with
        connection status, connect/disconnect/reconnect actions, per-service detail panels showing
        health and last sync time, and a shared vs. personal key indicator for TMDB and TVDB.
      </p>
    </div>
  );
}
