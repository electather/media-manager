// fallow-ignore-file unused-file
import { and, eq, isNull, lte, or } from "drizzle-orm";
import { consola } from "consola";
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

const log = consola.withTag("notifications.deliver");

class UserConfigParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserConfigParseError";
  }
}

/**
 * `service_connections.user_config` is stored as a JSON text column. Plugins
 * expect the parsed object on `args.channelConfig` + `ctx.config.user`, so
 * decode once at the job boundary. Returns `null` for connections that have
 * no user-config (legitimate for no-fields plugins like inbox). Throws
 * `UserConfigParseError` on malformed JSON so the caller can mark the
 * delivery failed with a precise error code instead of handing the raw
 * string to a plugin that expects an object (every downstream `cfg.x` lookup
 * would resolve to `undefined`, surfacing as a cryptic upstream 4xx).
 */
function parseUserConfig(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UserConfigParseError(err instanceof Error ? err.message : String(err));
  }
}

export function registerDeliveryJob() {
  registerTriggerable<{ deliveryId: string }, void>({
    id: "notification.deliver",
    name: "Deliver notification",
    requiredPermission: "admin:jobs",
    // Lock the running-state per-delivery, not job-wide. emit() fans out one
    // trigger per recipient via Promise.all, so a 2-channel event would
    // race two triggers under the same job id; without a scope key the
    // second collides with the first as "already running" and never runs.
    // The deliveryId is unique per row + idempotent under retry, so it is
    // also the right scope to dedupe overlapping triggers from the
    // stale-pending sweep and the inline emit() path.
    scopeKey: (input) => input.deliveryId,
    // fallow-ignore-next-line complexity
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

      let channelConfig: unknown;
      try {
        channelConfig = parseUserConfig(conn.userConfig);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("user_config parse failed", {
          deliveryId,
          pluginId: conn.pluginId,
          error: msg,
        });
        await markDeliveryFailed(deliveryId, "config_parse_failed", msg);
        return;
      }

      log.info("delivery start", {
        deliveryId,
        pluginId: conn.pluginId,
        recipientUserId: delivery.recipientUserId,
        eventType: event.type,
        attempt: delivery.attemptCount + 1,
      });

      const loaded = await loadPluginAndContext(deliveryId, conn, delivery, channelConfig);
      if (!loaded) return;

      await executeDelivery(deliveryId, delivery, loaded, message, event, conn, channelConfig);
    },
  });
}

type PluginModule = Awaited<ReturnType<typeof pluginRuntime.getModule>>;
type PluginContext = Awaited<ReturnType<typeof pluginRuntime.buildJobContext>>;
type ServiceConnection = typeof serviceConnections.$inferSelect;
type DeliveryRow = typeof notificationDeliveries.$inferSelect;

// fallow-ignore-next-line complexity
async function loadPluginAndContext(
  deliveryId: string,
  conn: ServiceConnection,
  delivery: DeliveryRow,
  channelConfig: unknown,
): Promise<{ plugin: PluginModule; pluginCtx: PluginContext } | null> {
  let plugin: PluginModule;
  try {
    plugin = await pluginRuntime.getModule(conn.pluginId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("plugin load failed", { deliveryId, pluginId: conn.pluginId, error: msg });
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
      channelConfig,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("context build failed", { deliveryId, pluginId: conn.pluginId, error: msg });
    await markDeliveryFailed(deliveryId, "context_build_failed", msg);
    return null;
  }

  // Inbox is the only host-privileged plugin that needs an extended context.
  // When a second privileged plugin is added, restore the nested-if pattern
  // and branch here per plugin id.
  if (conn.pluginId === "inbox" && isHostPrivilegedPlugin(conn.pluginId)) {
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

// fallow-ignore-next-line complexity
async function executeDelivery(
  deliveryId: string,
  delivery: DeliveryRow,
  { plugin, pluginCtx }: { plugin: PluginModule; pluginCtx: PluginContext },
  message: ReturnType<typeof renderTemplate>,
  event: NotificationEvent,
  conn: ServiceConnection,
  channelConfig: unknown,
): Promise<void> {
  try {
    if (!plugin.capabilities?.notificationDelivery?.deliver) {
      log.error("plugin missing notificationDelivery.deliver", {
        deliveryId,
        pluginId: conn.pluginId,
      });
      await markDeliveryFailed(
        deliveryId,
        "missing_capability",
        "plugin missing notificationDelivery.deliver",
      );
      return;
    }

    // Third-party plugins get the SDK-typed args only. Host-privileged
    // plugins receive an extended shape so the inbox can persist with
    // the right user id and delivery linkage. `channelConfig` is the
    // parsed JSON object (or `null` for plugins with no userConfigSchema)
    // — passing the raw text column was a latent bug for every non-host
    // plugin since `cfg.botToken` etc. would resolve against a string.
    const deliverArgs = buildDeliverArgs(
      conn.pluginId,
      { message, event, channelConfig },
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
    log.success("delivery succeeded", { deliveryId, pluginId: conn.pluginId, providerMessageId });
    await updateDeliveryStatus(deliveryId, "succeeded", providerMessageId);
  } catch (err) {
    log.warn("delivery threw — routing to failure policy", {
      deliveryId,
      pluginId: conn.pluginId,
      error: err instanceof Error ? err.message : String(err),
    });
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
    log.error("delivery marked failed", {
      deliveryId,
      errorCode: decision.errorCode,
      errorMessage: decision.errorMessage,
      attempt: delivery.attemptCount + 1,
    });
    await markDeliveryFailed(deliveryId, decision.errorCode, decision.errorMessage);
    return;
  }
  log.info("delivery rescheduled", {
    deliveryId,
    errorCode: decision.errorCode,
    delayMs: decision.delayMs,
    attempt: delivery.attemptCount + 1,
  });
  await rescheduleDeliveryAttempt(
    deliveryId,
    Date.now() + decision.delayMs,
    decision.errorCode,
    decision.errorMessage,
  );
}
