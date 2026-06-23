// fallow-ignore-file complexity
// 3-condition OR = 1 DB round-trip by design (V18); split handler → multiple queries → atomicity lost
import { registerScheduled } from "../../jobs/scheduled";
import * as repo from "../repo";
import { triggerDeliveryForId } from "../service";

const STALE_THRESHOLD_MS = 2 * 60 * 1000;

/**
 * Scheduled sweep: retriggers whose retry/backoff window opened or initial trigger lost
 * (one query, design §V18). Three conditions: (1) `pending` where `nextAttemptAt <= now`,
 * (2) `pending` with no `nextAttemptAt` past stale threshold (post-emit/pre-trigger crash gap),
 * (3) `in_progress` past stale threshold (reset to pending for CAS pickup).
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
      let unregisteredCount = 0;
      for (const delivery of eligible) {
        if (delivery.status === "in_progress") {
          await repo.resetInProgressToPending(delivery.id);
          resetCount += 1;
        }

        try {
          const fired = await triggerDeliveryForId(delivery.id);
          if (fired) {
            triggerCount += 1;
          } else {
            // Surface the missing-job-registration path so a row reset back
            // to pending without a paired trigger doesn't loop silently —
            // happens on a cold worker before `notifications.registerJobs()`
            // completes. Logged once per sweep tick, not per row.
            unregisteredCount += 1;
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.logger.warn(`Failed to requeue delivery ${delivery.id}: ${msg}`);
        }
      }

      if (unregisteredCount > 0) {
        ctx.logger.warn(
          `Notification sweep: ${unregisteredCount} row(s) reset to pending but the notification.deliver job is not registered; next sweep tick will retry`,
        );
      }
      ctx.logger.info(
        `Notification sweep: requeued ${triggerCount} (reset ${resetCount} in_progress)`,
      );
    },
  });
}
