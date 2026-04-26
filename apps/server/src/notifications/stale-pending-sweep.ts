import { and, eq, lt, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { notificationDeliveries } from "../db/schema";
import { find } from "../jobs/registry";
import { registerScheduled } from "../jobs/scheduled";
import { newRequestId } from "../errors/request-context";

export function registerStalePendingSweep() {
  registerScheduled({
    id: "host.notifications.stale_pending_sweep",
    name: "Notification stale pending sweep",
    description: "Requeue deliveries stuck in pending status",
    schedule: "*/5 * * * *",
    handler: async (ctx) => {
      const db = getDb();
      const twoMinutesAgo = Date.now() - 2 * 60 * 1000;

      const staleDeliveries = await db
        .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
        .from(notificationDeliveries)
        .where(
          and(
            or(
              eq(notificationDeliveries.status, "pending"),
              eq(notificationDeliveries.status, "in_progress"),
            ),
            lt(notificationDeliveries.updatedAt, twoMinutesAgo),
          ),
        )
        .limit(100)
        .all();

      const jobEntry = find("notification.deliver");
      if (!jobEntry?.triggerFromApi) return;

      for (const delivery of staleDeliveries) {
        // Reset in_progress rows back to pending for crash recovery.
        // Handler's CAS only accepts pending; without reset, row stays stuck forever.
        if (delivery.status === "in_progress") {
          await db
            .update(notificationDeliveries)
            .set({ status: "pending", updatedAt: Date.now() })
            .where(
              and(
                eq(notificationDeliveries.id, delivery.id),
                eq(notificationDeliveries.status, "in_progress"),
              ),
            )
            .run();
        }

        try {
          await jobEntry.triggerFromApi(
            { deliveryId: delivery.id },
            {
              triggeredBy: "admin",
              requestId: newRequestId(),
            },
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn(`Failed to requeue delivery ${delivery.id}: ${msg}`);
        }
      }

      ctx.logger.info(`Requeued ${staleDeliveries.length} stale pending deliveries`);
    },
  });
}
