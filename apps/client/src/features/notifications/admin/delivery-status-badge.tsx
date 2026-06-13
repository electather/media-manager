import type { NotificationDeliveryStatus } from "@nama/shared/notifications";
import { cn } from "@/shared/lib/utils";
import { m } from "@/paraglide/messages";

const STATUS_LABELS: Record<NotificationDeliveryStatus, () => string> = {
  pending: () => m.notifications_admin_status_pending(),
  in_progress: () => m.notifications_admin_status_in_progress(),
  succeeded: () => m.notifications_admin_status_succeeded(),
  failed: () => m.notifications_admin_status_failed(),
};

const STATUS_CLASS: Record<NotificationDeliveryStatus, string> = {
  pending: "bg-muted text-muted-foreground",
  in_progress: "bg-primary/15 text-primary",
  succeeded: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  failed: "bg-destructive/15 text-destructive",
};

export function DeliveryStatusBadge({ status }: { status: NotificationDeliveryStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        STATUS_CLASS[status],
      )}
    >
      {STATUS_LABELS[status]()}
    </span>
  );
}
