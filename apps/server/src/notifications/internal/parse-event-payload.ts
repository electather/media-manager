import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { notificationEventSchema } from "@ent-mcp/shared/notifications";

/**
 * Safely parses a stored delivery event payload. Returns `null` when the JSON
 * is corrupt OR when the parsed shape no longer matches the current
 * `notificationEventSchema` — schema drift across deploys is silent
 * otherwise, and casting through `as NotificationEvent` would surface
 * partial objects to downstream renderers / templates.
 *
 * Shared by `service.getDeliveryDetail` (admin detail view) and
 * `jobs/delivery.ts` (the per-delivery handler that drives `renderTemplate`).
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
