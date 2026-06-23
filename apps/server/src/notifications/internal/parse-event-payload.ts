import type { NotificationEvent } from "@nama/shared/notifications";
import { notificationEventSchema } from "@nama/shared/notifications";

/**
 * Safely parses stored event payload. Returns null if JSON is corrupt or shape
 * no longer matches notificationEventSchema—prevents schema drift from surfacing
 * partial objects to renderers/templates. Used by getDeliveryDetail + jobs/delivery.
 */
export function parseStoredEventPayload(raw: string): NotificationEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = notificationEventSchema.safeParse(parsed);
  return result.success ? (result.data as NotificationEvent) : null;
}
