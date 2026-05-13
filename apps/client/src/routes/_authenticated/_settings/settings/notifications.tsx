import { createFileRoute } from "@tanstack/react-router";

import {
  SettingsNotificationsRoute,
  SettingsNotificationsRouteErrorFallback,
} from "@/features/settings-notifications";

export const Route = createFileRoute("/_authenticated/_settings/settings/notifications")({
  errorComponent: SettingsNotificationsRouteErrorFallback,
  component: SettingsNotificationsRoute,
});
