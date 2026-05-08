import { createFileRoute } from "@tanstack/react-router";

import { AppShell } from "@/app/app-shell";

/**
 * Route layout for the authenticated app shell. Now a thin component — the
 * command menu sources its media via the `/api/search` and
 * `/api/discover/trending` endpoints itself, so this route no longer wires
 * an in-memory media provider.
 */
function AppLayout() {
  return <AppShell />;
}

export const Route = createFileRoute("/_authenticated/_app")({
  component: AppLayout,
});
