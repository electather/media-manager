import { createFileRoute } from "@tanstack/react-router";

import { SettingsSecurityRoute } from "@/features/settings-security";

export const Route = createFileRoute("/_authenticated/_settings/settings/security")({
  component: SettingsSecurityRoute,
});
