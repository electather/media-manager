import { randomUUID } from "node:crypto";
import { env } from "../env";
import { registerSink } from "../diagnostics/capture";
import { findEntry } from "../jobs/registry";
import { newRequestId } from "../diagnostics/request-context";
import type {
  AdminDeliveryRow,
  InboxItemDto,
  NotificationCategory,
  NotificationEvent,
  NotificationSeverity,
} from "@ent-mcp/shared/notifications";
import { notificationEventSchema } from "@ent-mcp/shared/notifications";
import * as repo from "./repo";
import { resolveRecipients } from "./internal/resolve-recipients";
import { NotificationErrorSink } from "./internal/error-sink";
import type { NotificationSettings } from "./types";

/**
 * Public sync surface for `notifications/`. Other modules call methods on the
 * singleton via `getNotificationsService()`; cross-module callers that
 * previously imported `notifications/emit` now go through typed events (see
 * `jobs/runtime-events.ts`, `media/events.ts`, `plugin-runtime/events.ts`)
 * whose handlers in `jobs/` land on `publishNotification`.
 *
 * `service.ts` calls `repo.*` only — drizzle-orm is isolated inside `repo/**`.
 */
export class NotificationsService {
  /**
   * Validates the event, resolves recipients, inserts deliveries in a single
   * transaction, and triggers the delivery job per row. No-op when the runtime
   * has notifications disabled. Throws on zod validation failure so the
   * caller's transaction (if any) rolls back.
   */
  async publishNotification(
    event: NotificationEvent | Omit<NotificationEvent, "id" | "occurredAt">,
  ): Promise<void> {
    if (!env.NOTIFICATIONS_ENABLED) return;

    const validated = enrichAndValidate(event);
    const recipients = await resolveRecipients(validated);
    if (recipients.length === 0) return;

    const deliveryIds = await repo.createDeliveriesForEvent(validated, recipients);
    await this.triggerDeliveryFanout(deliveryIds);
  }

  // ─── settings ────────────────────────────────────────────────────────────

  async getSettings(): Promise<NotificationSettings> {
    return repo.getSettings();
  }

  async updateSettings(input: {
    inboxRetentionDays?: number;
    deliveryRetentionDays?: number;
  }): Promise<NotificationSettings> {
    return repo.updateSettings(input);
  }

  // ─── inbox ───────────────────────────────────────────────────────────────

  async listInbox(
    userId: string,
    filters: {
      unreadOnly?: boolean;
      category?: NotificationCategory;
      severity?: NotificationSeverity;
    },
    cursor: { createdAt: number; id: string } | undefined,
    limit: number,
    opts: { direction?: "before" | "after" } = {},
  ): Promise<InboxItemDto[]> {
    const rows = await repo.listInboxForUser(userId, filters, cursor, limit, opts);
    return rows.map(repo.inboxRowToDto);
  }

  async getUnreadCount(userId: string): Promise<number> {
    return repo.getUnreadCount(userId);
  }

  async markInboxRead(userId: string, ids: string[]): Promise<number> {
    return repo.markInboxReadForUser(userId, ids);
  }

  async markInboxUnread(userId: string, ids: string[]): Promise<number> {
    return repo.markInboxUnreadForUser(userId, ids);
  }

  async markAllInboxRead(userId: string, category?: NotificationCategory): Promise<number> {
    return repo.markAllReadForUser(userId, category);
  }

  async deleteInbox(userId: string, ids: string[]): Promise<number> {
    return repo.deleteInboxForUser(userId, ids);
  }

  async deleteAllInbox(
    userId: string,
    opts: { readOnly?: boolean; olderThanMs?: number },
  ): Promise<number> {
    return repo.deleteInboxAllForUser(userId, opts);
  }

  // ─── subscriptions ───────────────────────────────────────────────────────

  async listSubscriptions(connectionIds: string[]) {
    return repo.listSubscriptionsForConnections(connectionIds);
  }

  async upsertSubscription(
    connectionId: string,
    category: NotificationCategory,
    enabled: boolean,
  ): Promise<void> {
    await repo.upsertSubscription(connectionId, category, enabled);
  }

  // ─── deliveries (admin) ──────────────────────────────────────────────────

  async listDeliveries(
    filters: repo.DeliveryListFilters,
    cursor: repo.DeliveryCursor | undefined,
    limit: number,
  ): Promise<AdminDeliveryRow[]> {
    const rows = await repo.listDeliveries(filters, cursor, limit);
    return rows.map(repo.deliveryRowToDto);
  }

  /**
   * Returns the delivery DTO plus the parsed event payload for the admin
   * detail view. `eventPayload` is `null` when the stored JSON is corrupt OR
   * when its shape no longer matches the current `notificationEventSchema`
   * (schema drift between an old row and a newer notion of the event); the
   * client hides the section when the field is missing rather than rendering
   * a confusing partial object.
   */
  async getDeliveryDetail(
    id: string,
  ): Promise<{ delivery: AdminDeliveryRow; eventPayload: NotificationEvent | null } | null> {
    const row = await repo.getDelivery(id);
    if (!row) return null;
    const eventPayload = parseStoredEventPayload(row.eventPayload);
    return { delivery: repo.deliveryRowToDto(row), eventPayload };
  }

  async resetDeliveryForRetry(id: string): Promise<repo.RetryResetResult> {
    return repo.resetDeliveryForRetry(id);
  }

  /**
   * Triggers a single delivery row. Returns `true` if the job ran, `false` if
   * the `notification.deliver` job is not registered yet (stale-pending sweep
   * is the fallback path in that case).
   */
  async triggerDeliveryRetry(id: string): Promise<boolean> {
    const jobEntry = findEntry("notification.deliver");
    if (!jobEntry?.triggerFromApi) return false;
    await jobEntry.triggerFromApi(
      { deliveryId: id },
      { triggeredBy: "admin", requestId: newRequestId() },
    );
    return true;
  }

  // ─── internal fan-out ────────────────────────────────────────────────────

  /**
   * Per-row trigger fan-out used by `publishNotification`. Marked `cron` so
   * the `job_runs` audit trail attributes these as system-initiated; the
   * admin path (`triggerDeliveryRetry`) keeps `admin` because that one IS a
   * direct admin action.
   */
  private async triggerDeliveryFanout(deliveryIds: readonly string[]): Promise<void> {
    const jobEntry = findEntry("notification.deliver");
    if (!jobEntry?.triggerFromApi) return;
    const triggerApi = jobEntry.triggerFromApi;
    await Promise.all(
      deliveryIds.map((deliveryId) =>
        triggerApi({ deliveryId }, { triggeredBy: "cron", requestId: newRequestId() }),
      ),
    );
  }
}

/**
 * Safely parses a stored delivery event payload. Returns `null` when the
 * JSON is corrupt OR when the parsed shape no longer matches the current
 * `notificationEventSchema` — schema drift across deploys is silent
 * otherwise, and casting through `as NotificationEvent` would surface
 * partial objects to the admin detail view.
 */
function parseStoredEventPayload(raw: string): NotificationEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const result = notificationEventSchema.safeParse(parsed);
  return result.success ? (result.data as NotificationEvent) : null;
}

/**
 * Enriches an event with host-generated id + occurredAt (when absent), then
 * runs the zod schema. Kept outside the class so `publishNotification` stays
 * thin and its CRAP score stays under the `health.maxCrap` budget; the
 * branching here is what bloats the metric.
 */
function enrichAndValidate(
  event: NotificationEvent | Omit<NotificationEvent, "id" | "occurredAt">,
): NotificationEvent {
  const partial = event as Partial<NotificationEvent> &
    Omit<NotificationEvent, "id" | "occurredAt">;
  const enriched = {
    ...partial,
    id: partial.id ?? randomUUID(),
    occurredAt: partial.occurredAt ?? new Date().toISOString(),
  } as NotificationEvent;
  return notificationEventSchema.parse(enriched) as NotificationEvent;
}

let instance: NotificationsService | null = null;

export function getNotificationsService(): NotificationsService {
  if (!instance) instance = new NotificationsService();
  return instance;
}

/** Test helper: drop the singleton so the next `get` rebuilds from scratch. */
export function resetNotificationsServiceForTest(): void {
  instance = null;
}

/**
 * Registers the diagnostics sink that converts critical errors into
 * `system.error` notifications. Called from `apps/server/src/{index,worker}.ts`
 * after `registerJobs()` so the delivery job is already in the registry by the
 * time the first error fires.
 */
export function registerNotificationErrorSink(): void {
  const service = getNotificationsService();
  registerSink(new NotificationErrorSink((event) => service.publishNotification(event)));
}

/**
 * Used by the stale-pending sweep to retrigger one delivery row. Returns
 * `true` when the trigger fired, `false` when the delivery job is not yet
 * registered (cold worker before `registerJobs()` settles); the caller logs
 * the no-op so the row does not silently spin in pending-reset purgatory.
 * Marked `cron` because the sweep is a scheduled retry, not an admin action.
 */
export async function triggerDeliveryForId(deliveryId: string): Promise<boolean> {
  const jobEntry = findEntry("notification.deliver");
  if (!jobEntry?.triggerFromApi) return false;
  await jobEntry.triggerFromApi({ deliveryId }, { triggeredBy: "cron", requestId: newRequestId() });
  return true;
}
