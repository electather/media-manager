import { createFileRoute } from "@tanstack/react-router";

import { SettingsProfileRoute } from "@/features/settings-profile";

export const Route = createFileRoute("/_authenticated/_settings/settings/profile")({
  component: SettingsProfileRoute,
});
