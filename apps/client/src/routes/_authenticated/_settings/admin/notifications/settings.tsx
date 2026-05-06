import { createFileRoute } from "@tanstack/react-router";
import { fetchAdminSettings } from "@/features/notifications/shared/fetchers";
import { notificationsKeys } from "@/features/notifications/shared/query-keys";
import { NotificationsErrorBoundary } from "@/features/notifications/shared/error-boundary";
import { RetentionSettingsPage } from "@/features/notifications/admin/retention-settings-page";

export const Route = createFileRoute("/_authenticated/_settings/admin/notifications/settings")({
  loader: ({ context: { queryClient } }) =>
    queryClient.ensureQueryData({
      queryKey: notificationsKeys.admin.settings(),
      queryFn: fetchAdminSettings,
    }),
  errorComponent: ({ error }) => (
    <NotificationsErrorBoundary>
      <div className="p-6">{error.message}</div>
    </NotificationsErrorBoundary>
  ),
  component: () => (
    <NotificationsErrorBoundary>
      <RetentionSettingsPage />
    </NotificationsErrorBoundary>
  ),
});
