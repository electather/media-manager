import { randomUUID } from "node:crypto";
import { env } from "../env";
import { getDb } from "../db/client";
import type { NotificationEvent, BaseEvent } from "@ent-mcp/shared/notifications";
import { notificationDeliveries } from "../db/schema/notifications";
import { resolveRecipients } from "./resolve-recipients";
import { find } from "../jobs/registry";
import { newRequestId } from "../errors/request-context";

export async function emit(
  event: Omit<NotificationEvent, keyof BaseEvent> & Partial<Pick<BaseEvent, "id" | "occurredAt">>,
): Promise<void> {
  if (!env.NOTIFICATIONS_ENABLED) return;

  const enriched = {
    id: event.id ?? randomUUID(),
    occurredAt: event.occurredAt ?? new Date().toISOString(),
    ...event,
  } as NotificationEvent;

  const recipients = await resolveRecipients(enriched);

  const db = getDb();
  const deliveryIds: string[] = [];

  await db.transaction(async (tx) => {
    const values = recipients.map((r) => {
      const id = randomUUID();
      deliveryIds.push(id);
      return {
        id,
        eventId: enriched.id,
        eventType: enriched.type,
        eventPayload: JSON.stringify(enriched),
        recipientConnectionId: r.connectionId,
        recipientUserId: r.userId,
        status: "pending" as const,
        attemptCount: 0,
        correlationKey: enriched.correlationKey ?? null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
    });
    await tx.insert(notificationDeliveries).values(values);
  });

  const jobEntry = find("notification.deliver");
  if (!jobEntry?.triggerFromApi) return;

  for (const deliveryId of deliveryIds) {
    await jobEntry.triggerFromApi(
      { deliveryId },
      {
        triggeredBy: "admin",
        requestId: newRequestId(),
      },
    );
  }
}
