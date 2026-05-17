import { randomUUID } from "node:crypto";
import { consola } from "consola";
import { renderTemplate } from "../templates";
import * as repo from "../repo";
import { pluginRuntime, type ConnectionRow } from "../../plugin-runtime";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { buildDeliverArgs, decideFailure, isHostPrivilegedPlugin } from "./delivery-policy";
import { UserConfigParseError } from "../errors";

const log = consola.withTag("notifications.deliver");

interface DeliveryRow {
  attemptCount: number;
  recipientUserId: string;
}

type PluginModule = Awaited<ReturnType<typeof pluginRuntime.getModule>>;
type PluginContext = Awaited<ReturnType<typeof pluginRuntime.buildJobContext>>;

/**
 * `service_connections.user_config` is stored as a JSON text column. Plugins
 * expect the parsed object on `args.channelConfig` + `ctx.config.user`, so
 * decode once at the job boundary. Returns `null` for connections that have
 * no user-config. Throws `UserConfigParseError` on malformed JSON so the
 * caller marks the delivery failed with a precise error code.
 */
export function parseUserConfig(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new UserConfigParseError(err instanceof Error ? err.message : String(err));
  }
}

// fallow-ignore-next-line complexity
export async function loadPluginAndContext(
  deliveryId: string,
  conn: ConnectionRow,
  delivery: { recipientUserId: string },
  channelConfig: unknown,
): Promise<{ plugin: PluginModule; pluginCtx: PluginContext } | null> {
  let plugin: PluginModule;
  try {
    plugin = await pluginRuntime.getModule(conn.pluginId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("plugin load failed", { deliveryId, pluginId: conn.pluginId, error: msg });
    await repo.markDeliveryFailed(deliveryId, "plugin_load_failed", msg);
    return null;
  }

  // Use the same context-building path as job handlers: pulls `manifest.allowedHosts`,
  // resolves dynamic `x-allowed-host` entries from the user's channel config, and
  // intersects against the admin allowlist + headers. A bare empty-allowlist
  // context would block every outbound HTTP call.
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
    await repo.markDeliveryFailed(deliveryId, "context_build_failed", msg);
    return null;
  }

  // Inbox is the only host-privileged plugin that needs an extended context.
  if (conn.pluginId === "inbox" && isHostPrivilegedPlugin(conn.pluginId)) {
    pluginCtx = {
      ...pluginCtx,
      inbox: {
        insert: (
          row: Omit<Parameters<typeof repo.insertInboxItem>[0], "id" | "userId" | "deliveryId">,
        ) =>
          repo.insertInboxItem({
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
export async function executeDelivery(
  deliveryId: string,
  delivery: DeliveryRow,
  { plugin, pluginCtx }: { plugin: PluginModule; pluginCtx: PluginContext },
  message: ReturnType<typeof renderTemplate>,
  event: NotificationEvent,
  conn: ConnectionRow,
  channelConfig: unknown,
): Promise<void> {
  try {
    if (!plugin.capabilities?.notificationDelivery?.deliver) {
      log.error("plugin missing notificationDelivery.deliver", {
        deliveryId,
        pluginId: conn.pluginId,
      });
      await repo.markDeliveryFailed(
        deliveryId,
        "missing_capability",
        "plugin missing notificationDelivery.deliver",
      );
      return;
    }

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
    await repo.updateDeliveryStatus(deliveryId, "succeeded", providerMessageId);
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
  delivery: DeliveryRow,
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
    await repo.markDeliveryFailed(deliveryId, decision.errorCode, decision.errorMessage);
    return;
  }
  log.info("delivery rescheduled", {
    deliveryId,
    errorCode: decision.errorCode,
    delayMs: decision.delayMs,
    attempt: delivery.attemptCount + 1,
  });
  await repo.rescheduleDeliveryAttempt(
    deliveryId,
    Date.now() + decision.delayMs,
    decision.errorCode,
    decision.errorMessage,
  );
}
