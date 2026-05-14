// Decision (TASK-009): The `notifications_inbox` table does not expose
// `event_type`. Adding that column requires a DB migration, which is out of
// scope for this PR (CON-003). Filter is therefore severity-only for now.
// The USER_ACTIONABLE_EVENT_TYPES carve-out is tracked as a follow-up.
import type { NotificationItemDto } from "../shared/types";

export function isToastable(item: NotificationItemDto): boolean {
  return item.severity === "warn" || item.severity === "error";
}
