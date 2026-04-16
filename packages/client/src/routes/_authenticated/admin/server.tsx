import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/server")({
  component: AdminServerPage,
});

/** Gated by admin:server permission. */
function AdminServerPage() {
  return (
    <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 px-4 lg:px-6">
      <h1 className="text-2xl font-bold">Server</h1>
      <p className="text-muted-foreground">
        Server configuration. Sections: Shared API Keys (server-level TMDB/TVDB keys users can opt
        into), Registration (toggle open registration, manage active invite links, set default
        role), Cache (hit rate and size stats, manual flush button), and MCP (server endpoint URL
        and connected client stats).
      </p>
    </div>
  );
}
