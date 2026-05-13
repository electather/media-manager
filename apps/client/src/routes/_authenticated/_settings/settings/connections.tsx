import { createFileRoute } from "@tanstack/react-router";

import { SettingsConnectionsRoute } from "@/features/settings-connections";

export const Route = createFileRoute("/_authenticated/_settings/settings/connections")({
  component: SettingsConnectionsRoute,
});
