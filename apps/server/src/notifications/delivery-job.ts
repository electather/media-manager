import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { notificationDeliveries, serviceConnections } from "../db/schema";
import { env } from "../env";
import { renderTemplate } from "./templates";
import { updateDeliveryStatus, recordDeliveryAttempt, insertInboxItem } from "./repos";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { buildContext } from "../plugin-runtime/context";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { registerTriggerable } from "../jobs/triggerable";

export function registerDeliveryJob() {
  registerTriggerable<{ deliveryId: string }, void>({
    id: "notification.deliver",
    name: "Deliver notification",
    requiredPermission: "admin:jobs",
    handler: async (_ctx, input) => {
      if (!env.NOTIFICATIONS_ENABLED || !input) return;

      const { deliveryId } = input;
      const db = getDb();

      // Atomic CAS: only proceed if we can transition from pending to in_progress.
      // Prevents duplicate delivery if sweep retriggers during flight.
      const updated = await db
        .update(notificationDeliveries)
        .set({ status: "in_progress", updatedAt: Date.now() })
        .where(
          and(
            eq(notificationDeliveries.id, deliveryId),
            eq(notificationDeliveries.status, "pending"),
          ),
        )
        .returning()
        .get();

      if (!updated) return;

      const delivery = updated;

      const event = JSON.parse(delivery.eventPayload) as NotificationEvent;
      const message = renderTemplate(event, "en");

      if (!delivery.recipientConnectionId) {
        await updateDeliveryStatus(deliveryId, "failed", null);
        return;
      }

      const conn = await db
        .select()
        .from(serviceConnections)
        .where(eq(serviceConnections.id, delivery.recipientConnectionId))
        .get();

      if (!conn) {
        await updateDeliveryStatus(deliveryId, "failed", null);
        return;
      }

      let plugin;
      try {
        plugin = await pluginRuntime.getModule(conn.pluginId);
      } catch {
        await updateDeliveryStatus(deliveryId, "failed", null);
        return;
      }

      let pluginCtx = buildContext({
        pluginId: conn.pluginId,
        allowedHosts: [],
        userId: conn.userId,
        appBaseUrl: env.APP_EXTERNAL_URL,
        userConfig: conn.userConfig,
      });

      // Inject host-privileged inbox context for built-in inbox plugin.
      if (conn.pluginId === "inbox") {
        pluginCtx = {
          ...pluginCtx,
          inbox: {
            insert: (row: Omit<Parameters<typeof insertInboxItem>[0], "id">) =>
              insertInboxItem({ ...row, id: randomUUID() }),
          },
        } as any;
      }

      try {
        if (!plugin.capabilities?.notificationDelivery?.deliver) {
          await updateDeliveryStatus(deliveryId, "failed", null);
          return;
        }
        const result = await plugin.capabilities.notificationDelivery.deliver(pluginCtx, {
          message,
          event,
          channelConfig: conn.userConfig,
          deliveryId,
          recipientUserId: delivery.recipientUserId,
        } as any);
        const providerMessageId =
          result && typeof result === "object" && "providerMessageId" in result
            ? (result as any).providerMessageId
            : null;
        await updateDeliveryStatus(deliveryId, "succeeded", providerMessageId);
      } catch (err) {
        await handleDeliveryFailure(deliveryId, delivery, err);
      }
    },
  });
}

async function handleDeliveryFailure(
  deliveryId: string,
  delivery: typeof notificationDeliveries.$inferSelect,
  error: unknown,
): Promise<void> {
  const isRetryable =
    error instanceof Error && "retryable" in error && typeof error.retryable === "boolean"
      ? error.retryable
      : delivery.attemptCount < 5;

  const errorCode =
    error instanceof Error && "code" in error ? String(error.code) : "unknown_error";
  const errorMessage = error instanceof Error ? error.message : String(error);

  if (isRetryable && delivery.attemptCount < 5) {
    await recordDeliveryAttempt(deliveryId, errorCode, errorMessage);
  } else {
    await updateDeliveryStatus(deliveryId, "failed", null);
  }
}
