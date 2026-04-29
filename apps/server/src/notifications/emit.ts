import { randomUUID } from "node:crypto";
import { env } from "../env";
import { getDb } from "../db/client";
import type { NotificationEvent, BaseEvent } from "@ent-mcp/shared/notifications";
import { notificationEventSchema } from "@ent-mcp/shared/notifications";
import { notificationDeliveries } from "../db/schema/notifications";
import { resolveRecipients } from "./resolve-recipients";
import { findEntry } from "../jobs/registry";
import { newRequestId } from "../errors/request-context";

// fallow-ignore-next-line complexity
export async function emit(
  event: Omit<NotificationEvent, keyof BaseEvent> & Partial<Pick<BaseEvent, "id" | "occurredAt">>,
): Promise<void> {
  if (!env.NOTIFICATIONS_ENABLED) return;

  const enriched = {
    id: event.id ?? randomUUID(),
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  } as NotificationEvent;

  const validated = notificationEventSchema.parse(enriched) as NotificationEvent;

  const recipients = await resolveRecipients(validated);

  const db = getDb();
  const deliveryIds: string[] = [];

  await db.transaction(async (tx) => {
    const values = recipients.map((r) => {
      const id = randomUUID();
      deliveryIds.push(id);
      return {
        id,
        eventId: validated.id,
        eventType: validated.type,
        eventPayload: JSON.stringify(validated),
        recipientConnectionId: r.connectionId,
        recipientUserId: r.userId,
        status: "pending" as const,
        attemptCount: 0,
        correlationKey: validated.correlationKey ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    await tx.insert(notificationDeliveries).values(values);
  });

  const jobEntry = findEntry("notification.deliver");
  if (!jobEntry?.triggerFromApi) return;

  const triggerApi = jobEntry.triggerFromApi;
  await Promise.all(
    deliveryIds.map((deliveryId) =>
      triggerApi(
        { deliveryId },
        {
          triggeredBy: "admin",
          requestId: newRequestId(),
        },
      ),
    ),
  );
}
