import { createFileRoute } from "@tanstack/react-router";
import { SettingsNotificationsPage } from "@/features/notifications/settings/settings-page";
import { NotificationsErrorFallback } from "@/features/notifications/shared/error-boundary";

export const Route = createFileRoute("/_authenticated/_settings/settings/notifications")({
  errorComponent: NotificationsErrorFallback,
  component: SettingsNotificationsPage,
});
