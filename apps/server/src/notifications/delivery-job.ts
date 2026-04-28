// fallow-ignore-file unused-file
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
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { registerTriggerable } from "../jobs/triggerable";
import { buildDeliverArgs, decideFailure, isHostPrivilegedPlugin } from "./delivery-policy";

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

      const loaded = await loadPluginAndContext(deliveryId, conn, delivery);
      if (!loaded) return;

      await executeDelivery(deliveryId, delivery, loaded, message, event, conn);
    },
  });
}

type PluginModule = Awaited<ReturnType<typeof pluginRuntime.getModule>>;
type PluginContext = Awaited<ReturnType<typeof pluginRuntime.buildJobContext>>;
type ServiceConnection = typeof serviceConnections.$inferSelect;
type DeliveryRow = typeof notificationDeliveries.$inferSelect;

async function loadPluginAndContext(
  deliveryId: string,
  conn: ServiceConnection,
  delivery: DeliveryRow,
): Promise<{ plugin: PluginModule; pluginCtx: PluginContext } | null> {
  let plugin: PluginModule;
  try {
    plugin = await pluginRuntime.getModule(conn.pluginId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markDeliveryFailed(deliveryId, "plugin_load_failed", msg);
    return null;
  }

  // Use the same context-building path as job handlers: it pulls the
  // plugin's `manifest.allowedHosts`, resolves dynamic `x-allowed-host`
  // entries from the user's channel config, and intersects against the
  // admin allowlist + headers. Building a bare context with an empty
  // allowlist would block every outbound HTTP call.
  let pluginCtx: PluginContext;
  try {
    pluginCtx = await pluginRuntime.buildJobContext(
      conn.pluginId,
      conn.userId,
      null,
      conn.userConfig,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await markDeliveryFailed(deliveryId, "context_build_failed", msg);
    return null;
  }

  // Inject host-privileged context fields for plugins on the privilege
  // allowlist. The privilege gate is `isHostPrivilegedPlugin` so a
  // future host-privileged plugin only needs to be added to the set
  // once; this block branches per-plugin id to attach the right shape
  // (today only inbox needs `ctx.inbox.insert`).
  if (isHostPrivilegedPlugin(conn.pluginId) && conn.pluginId === "inbox") {
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

  return { plugin, pluginCtx };
}

async function executeDelivery(
  deliveryId: string,
  delivery: DeliveryRow,
  { plugin, pluginCtx }: { plugin: PluginModule; pluginCtx: PluginContext },
  message: ReturnType<typeof renderTemplate>,
  event: NotificationEvent,
  conn: ServiceConnection,
): Promise<void> {
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
