// fallow-ignore-file complexity
// 3-condition OR = 1 DB round-trip by design (V18); split handler → multiple queries → atomicity lost
import { registerScheduled } from "../../jobs/scheduled";
import * as repo from "../repo";
import { triggerDeliveryForId } from "../service";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Scheduled sweep that re-triggers deliveries whose retry window has opened
 * or whose initial trigger was lost. Two retriggers, one query:
 *   1. `pending` rows whose backoff window has opened (`nextAttemptAt <= now`).
 *   2. `pending` rows that never had a `nextAttemptAt` set but have been
 *      sitting longer than the stale threshold — covers the post-emit /
 *      pre-trigger crash gap.
 *   3. `in_progress` rows that exceed the stale threshold — reset to pending
 *      so the CAS in the delivery handler can pick them up.
 */
export function registerStalePendingSweep(): void {
  registerScheduled({
    id: "host.notifications.stale_pending_sweep",
    name: "Notification stale pending sweep",
    description:
      "Requeue deliveries whose retry window has opened or whose initial trigger was lost",
    schedule: "*/5 * * * *",
    handler: async (ctx) => {
      const now = Date.now();
      const staleCutoff = now - STALE_THRESHOLD_MS;
      const eligible = await repo.listSweepEligible(now, staleCutoff, 100);

      let resetCount = 0;
      let triggerCount = 0;
      for (const delivery of eligible) {
        if (delivery.status === "in_progress") {
          await repo.resetInProgressToPending(delivery.id);
          resetCount += 1;
        }

        try {
          await triggerDeliveryForId(delivery.id);
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
