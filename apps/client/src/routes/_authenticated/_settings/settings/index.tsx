import { createFileRoute } from "@tanstack/react-router";

import { SettingsIndex } from "@/app/settings-layout";

export const Route = createFileRoute("/_authenticated/_settings/settings/")({
  component: SettingsIndex,
});
