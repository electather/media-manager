import { createFileRoute } from "@tanstack/react-router";

import { SettingsDangerRoute } from "@/features/settings-danger";

export const Route = createFileRoute("/_authenticated/_settings/settings/danger")({
  component: SettingsDangerRoute,
});
