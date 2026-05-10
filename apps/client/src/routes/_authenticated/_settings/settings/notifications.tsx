import { createFileRoute } from "@tanstack/react-router";
import {
  fetchCategories,
  fetchChannels,
  fetchPlugins,
  fetchSubscriptions,
} from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import {
  NotificationsErrorBoundary,
  NotificationsErrorFallback,
} from "@/features/notifications/shared/error-boundary";
import { NotificationsSettingsPage, SettingsSkeleton } from "@/features/notifications/settings";

export const Route = createFileRoute("/_authenticated/_settings/settings/notifications")({
  loader: ({ context: { queryClient } }) =>
    Promise.all([
      queryClient.ensureQueryData({
        queryKey: notificationsKeys.plugins(),
        queryFn: fetchPlugins,
      }),
      queryClient.ensureQueryData({
        queryKey: notificationsKeys.channels(),
        queryFn: fetchChannels,
      }),
      queryClient.ensureQueryData({
        queryKey: notificationsKeys.categories(),
        queryFn: fetchCategories,
      }),
      queryClient.ensureQueryData({
        queryKey: notificationsKeys.subscriptions(),
        queryFn: fetchSubscriptions,
      }),
    ]),
  pendingComponent: SettingsSkeleton,
  errorComponent: NotificationsErrorFallback,
  component: () => (
    <NotificationsErrorBoundary>
      <NotificationsSettingsPage />
    </NotificationsErrorBoundary>
  ),
});
