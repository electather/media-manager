import { consola } from "consola";
import { env } from "../../env";
import { renderTemplate } from "../templates";
import * as repo from "../repo";
import { getConnectionById } from "../../plugin-runtime";
import { registerTriggerable } from "../../jobs/triggerable";
import {
  executeDelivery,
  loadPluginAndContext,
  parseUserConfig,
} from "../internal/deliver-handler";
import { parseStoredEventPayload } from "../internal/parse-event-payload";

const log = consola.withTag("notifications.deliver");

/**
 * Triggerable per-delivery job. Locks the running-state per-deliveryId rather
 * than job-wide so concurrent emits for separate recipients do not collide on
 * "already running"; the deliveryId is unique per row and idempotent under
 * retry so it also dedupes overlapping triggers from the stale-pending sweep.
 *
 * Heavy lifting (plugin load, context build, deliver invocation, failure
 * policy) lives in `../internal/deliver-handler.ts` so this file stays under
 * the 200 LOC jobs cap. The handler here only wires the CAS claim + log +
 * dispatch.
 */
export function registerDelivery(): void {
  registerTriggerable<{ deliveryId: string }, void>({
    id: "notification.deliver",
    name: "Deliver notification",
    requiredPermission: "admin:jobs",
    scopeKey: (input) => input.deliveryId,
    // fallow-ignore-next-line complexity
    handler: async (_ctx, input) => {
      if (!env.NOTIFICATIONS_ENABLED || !input) return;

      const { deliveryId } = input;
      const claimed = await repo.claimPendingForInProgress(deliveryId);
      if (!claimed) return;

      const delivery = claimed;
      // Schema-validate the stored payload instead of casting blind. Schema
      // drift across deploys (or a row stored before a payload-shape change)
      // surfaces here as a typed failure rather than a partial object that
      // would silently flow into `renderTemplate` + the plugin deliver call.
      const event = parseStoredEventPayload(delivery.eventPayload);
      if (!event) {
        await repo.markDeliveryFailed(
          deliveryId,
          "invalid_payload",
          "stored event payload failed schema validation",
        );
        return;
      }
      const message = renderTemplate(event, "en");

      if (!delivery.recipientConnectionId) {
        await repo.markDeliveryFailed(
          deliveryId,
          "connection_deleted",
          "recipient connection missing",
        );
        return;
      }

      const conn = await getConnectionById(delivery.recipientConnectionId);
      if (!conn) {
        await repo.markDeliveryFailed(
          deliveryId,
          "connection_deleted",
          "recipient connection missing",
        );
        return;
      }

      let channelConfig: unknown;
      try {
        channelConfig = parseUserConfig(conn.userConfig);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        log.error("user_config parse failed", { deliveryId, pluginId: conn.pluginId, error: msg });
        await repo.markDeliveryFailed(deliveryId, "config_parse_failed", msg);
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
