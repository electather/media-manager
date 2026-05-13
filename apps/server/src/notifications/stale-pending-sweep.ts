// fallow-ignore-file complexity
// 3-condition OR = 1 DB round-trip by design (V18); split handler → multiple queries → atomicity lost
import { and, eq, isNull, lt, lte, or } from "drizzle-orm";
import { getDb } from "../db/client";
import { notificationDeliveries } from "../db/schema";
import { findEntry } from "../jobs/registry";
import { registerScheduled } from "../jobs/scheduled";
import { newRequestId } from "../diagnostics/request-context";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

export function registerStalePendingSweep() {
  registerScheduled({
    id: "host.notifications.stale_pending_sweep",
    name: "Notification stale pending sweep",
    description:
      "Requeue deliveries whose retry window has opened or whose initial trigger was lost",
    schedule: "*/5 * * * *",
    handler: async (ctx) => {
      const db = getDb();
      const now = Date.now();
      const staleCutoff = now - STALE_THRESHOLD_MS;

      // Two distinct retriggers, expressed as one query so the sweep is a
      // single round trip:
      // 1. `pending` rows whose backoff window has opened (`nextAttemptAt <=
      //    now`).
      // 2. `pending` rows that never had a `nextAttemptAt` set but have been
      //    sitting longer than the stale threshold — covers the post-emit /
      //    pre-trigger crash gap.
      // 3. `in_progress` rows that exceed the stale threshold — reset to
      //    pending below so the CAS in the delivery handler can pick them up
      //    on the next sweep tick.
      const eligible = await db
        .select({ id: notificationDeliveries.id, status: notificationDeliveries.status })
        .from(notificationDeliveries)
        .where(
          or(
            and(
              eq(notificationDeliveries.status, "pending"),
              lte(notificationDeliveries.nextAttemptAt, now),
            ),
            and(
              eq(notificationDeliveries.status, "pending"),
              isNull(notificationDeliveries.nextAttemptAt),
              lt(notificationDeliveries.updatedAt, staleCutoff),
            ),
            and(
              eq(notificationDeliveries.status, "in_progress"),
              lt(notificationDeliveries.updatedAt, staleCutoff),
            ),
          ),
        )
        .limit(100)
        .all();

      const jobEntry = findEntry("notification.deliver");
      if (!jobEntry?.triggerFromApi) return;

      let resetCount = 0;
      let triggerCount = 0;
      for (const delivery of eligible) {
        if (delivery.status === "in_progress") {
          // Reset crashed-mid-flight rows so the CAS predicate (status =
          // pending) can pick them up. nextAttemptAt is left null →
          // immediately eligible.
          await db
            .update(notificationDeliveries)
            .set({ status: "pending", nextAttemptAt: null, updatedAt: Date.now() })
            .where(
              and(
                eq(notificationDeliveries.id, delivery.id),
                eq(notificationDeliveries.status, "in_progress"),
              ),
            )
            .run();
          resetCount += 1;
        }

        try {
          await jobEntry.triggerFromApi(
            { deliveryId: delivery.id },
            { triggeredBy: "admin", requestId: newRequestId() },
          );
          triggerCount += 1;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn(`Failed to requeue delivery ${delivery.id}: ${msg}`);
        }
      }

      ctx.logger.info(
        `Notification sweep: requeued ${triggerCount} (reset ${resetCount} in_progress)`,
      );
    },
  });
}
