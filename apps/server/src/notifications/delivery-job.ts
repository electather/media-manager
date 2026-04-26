import { and, eq, isNull, lte, or } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { notificationDeliveries, serviceConnections } from "../db/schema";
import { env } from "../env";
import { renderTemplate } from "./templates";
import {
  insertInboxItem,
  markDeliveryFailed,
  rescheduleDeliveryAttempt,
  updateDeliveryStatus,
  type InsertInboxItemInput,
} from "./repos";
import { pluginRuntime } from "../plugin-runtime/runtime";
import { buildContext } from "../plugin-runtime/context";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { registerTriggerable } from "../jobs/triggerable";
import { buildDeliverArgs, decideFailure, isHostPrivilegedPlugin } from "./delivery-policy";

// Re-export pure-policy symbols so callers and tests can import from a
// single module while the IO-bound delivery handler still lives here.
export {
  BACKOFF_INTERVALS_MS,
  MAX_ATTEMPTS,
  buildDeliverArgs,
  decideFailure,
  isHostPrivilegedPlugin,
  pickRetryDelayMs,
  readFailureSignals,
  type FailureDecision,
} from "./delivery-policy";

export function registerDeliveryJob() {
  registerTriggerable<{ deliveryId: string }, void>({
    id: "notification.deliver",
    name: "Deliver notification",
    requiredPermission: "admin:jobs",
    handler: async (_ctx, input) => {
      if (!env.NOTIFICATIONS_ENABLED || !input) return;

      const { deliveryId } = input;
      const db = getDb();

      // Atomic CAS: only proceed if we can transition pending → in_progress
      // AND the row is eligible right now (nextAttemptAt is null or in the
      // past). Prevents duplicate delivery if a sweep retriggers during
      // flight, and prevents a backoff-pending row from running before its
      // window opens.
      const now = Date.now();
      const updated = await db
        .update(notificationDeliveries)
        .set({ status: "in_progress", nextAttemptAt: null, updatedAt: now })
        .where(
          and(
            eq(notificationDeliveries.id, deliveryId),
            eq(notificationDeliveries.status, "pending"),
            or(
              isNull(notificationDeliveries.nextAttemptAt),
              lte(notificationDeliveries.nextAttemptAt, now),
            ),
          ),
        )
        .returning()
        .get();

      if (!updated) return;

      const delivery = updated;

      const event = JSON.parse(delivery.eventPayload) as NotificationEvent;
      const message = renderTemplate(event, "en");

      if (!delivery.recipientConnectionId) {
        await markDeliveryFailed(deliveryId, "connection_deleted", "recipient connection missing");
        return;
      }

      const conn = await db
        .select()
        .from(serviceConnections)
        .where(eq(serviceConnections.id, delivery.recipientConnectionId))
        .get();

      if (!conn) {
        await markDeliveryFailed(deliveryId, "connection_deleted", "recipient connection missing");
        return;
      }

      let plugin;
      try {
        plugin = await pluginRuntime.getModule(conn.pluginId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markDeliveryFailed(deliveryId, "plugin_load_failed", msg);
        return;
      }

      const isHostPrivileged = isHostPrivilegedPlugin(conn.pluginId);

      let pluginCtx = buildContext({
        pluginId: conn.pluginId,
        allowedHosts: [],
        userId: conn.userId,
        appBaseUrl: env.APP_EXTERNAL_URL,
        userConfig: conn.userConfig,
      });

      // Inject host-privileged inbox capability for the in-tree inbox plugin
      // only. The host pre-binds the recipient user id and delivery id so the
      // plugin's `deliver()` only knows about the message — third-party
      // plugins never see these fields.
      if (isHostPrivileged && conn.pluginId === "inbox") {
        pluginCtx = {
          ...pluginCtx,
          inbox: {
            insert: (
              row: Pick<
                InsertInboxItemInput,
                "title" | "body" | "severity" | "category" | "actionUrl" | "imageUrl" | "imageAlt"
              >,
            ) =>
              insertInboxItem({
                id: randomUUID(),
                userId: delivery.recipientUserId,
                deliveryId,
                ...row,
              }),
          },
        } as typeof pluginCtx;
      }

      try {
        if (!plugin.capabilities?.notificationDelivery?.deliver) {
          await markDeliveryFailed(
            deliveryId,
            "missing_capability",
            "plugin missing notificationDelivery.deliver",
          );
          return;
        }

        // Third-party plugins get the SDK-typed args only. Host-privileged
        // plugins receive an extended shape so the inbox can persist with
        // the right user id and delivery linkage.
        const deliverArgs = buildDeliverArgs(
          conn.pluginId,
          { message, event, channelConfig: conn.userConfig },
          { deliveryId, recipientUserId: delivery.recipientUserId },
        );
        const result = await plugin.capabilities.notificationDelivery.deliver(
          pluginCtx,
          deliverArgs as Parameters<
            NonNullable<typeof plugin.capabilities.notificationDelivery>["deliver"]
          >[1],
        );
        const providerMessageId =
          result && typeof result === "object" && "providerMessageId" in result
            ? ((result as { providerMessageId?: string }).providerMessageId ?? null)
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
  const decision = decideFailure(delivery, error);
  if (decision.action === "fail") {
    await markDeliveryFailed(deliveryId, decision.errorCode, decision.errorMessage);
    return;
  }
  await rescheduleDeliveryAttempt(
    deliveryId,
    Date.now() + decision.delayMs,
    decision.errorCode,
    decision.errorMessage,
  );
}
