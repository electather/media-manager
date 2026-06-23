import { randomUUID } from "node:crypto";
import { consola } from "consola";
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
} from "@nama/shared/notifications";
import { notificationEventSchema } from "@nama/shared/notifications";
import * as repo from "./repo";
import { resolveRecipients } from "./internal/resolve-recipients";
import { NotificationErrorSink } from "./internal/error-sink";
import { parseStoredEventPayload } from "./internal/parse-event-payload";
import type { NotificationSettings } from "./types";

// Public sync surface for `notifications/`. Cross-module callers use typed events (see
// `jobs/runtime-events.ts`, `media/events.ts`, `plugin-runtime/events.ts`) whose handlers
// land on `publishNotification`. `service.ts` calls `repo.*` only — drizzle-orm is isolated inside `repo/**`.
export class NotificationsService {
  // Validates event, resolves recipients, inserts deliveries, triggers delivery jobs.
  // No-op when disabled. Throws on zod validation failure so caller's transaction rolls back.
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

  // Returns delivery DTO + parsed event payload. eventPayload is null on corrupt JSON or
  // schema drift (schema mismatch vs old row); client hides section rather than render partial.
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

  // Returns true if job ran, false if notification.deliver not yet registered (sweep is fallback).
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

  // Per-row fan-out marked `cron` so job_runs audit trail shows system-initiated (vs admin).
  // Uses Promise.allSettled so one failed trigger doesn't abort the rest; sweep catches rejections.
  private async triggerDeliveryFanout(deliveryIds: readonly string[]): Promise<void> {
    const jobEntry = findEntry("notification.deliver");
    if (!jobEntry?.triggerFromApi) return;
    const triggerApi = jobEntry.triggerFromApi;
    const results = await Promise.allSettled(
      deliveryIds.map((deliveryId) =>
        triggerApi({ deliveryId }, { triggeredBy: "cron", requestId: newRequestId() }),
      ),
    );
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        consola.warn(
          `notifications: delivery trigger failed for ${deliveryIds[i]} (sweep will retry): ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
        );
      }
    });
  }
}

// Enriches event with id + occurredAt, validates schema. Separate so publishNotification
// stays thin and CRAP score stays under health.maxCrap budget (branching would bloat metric).
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

// Registers diagnostics sink converting critical errors to system.error notifications.
// Called after registerJobs() so delivery job is in registry before first error fires.
export function registerNotificationErrorSink(): void {
  const service = getNotificationsService();
  registerSink(new NotificationErrorSink((event) => service.publishNotification(event)));
}

// Retriggers one delivery row. Returns true if fired, false if delivery job not yet registered
// (cold worker before registerJobs). Marked cron because sweep is scheduled retry, not admin action.
export async function triggerDeliveryForId(deliveryId: string): Promise<boolean> {
  const jobEntry = findEntry("notification.deliver");
  if (!jobEntry?.triggerFromApi) return false;
  await jobEntry.triggerFromApi({ deliveryId }, { triggeredBy: "cron", requestId: newRequestId() });
  return true;
}
