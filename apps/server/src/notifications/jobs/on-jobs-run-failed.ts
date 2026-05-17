import { on } from "../../jobs/events";
import { JOB_EVENTS, jobRunFailedPayload } from "../../jobs/runtime-events";
import { getNotificationsService } from "../service";

/**
 * Converts every non-success terminal job run into an admin-audience
 * `job.run.failed` notification. Subscribes through the typed wrapper instead
 * of the legacy infra→notifications cross import.
 */
export function registerOnJobsRunFailed(): void {
  on(JOB_EVENTS.RUN_FAILED, jobRunFailedPayload, async (payload) => {
    await getNotificationsService().publishNotification({
      type: "job.run.failed",
      category: "system",
      severity: "error",
      audience: { kind: "admin", permission: "admin:server" },
      payload: {
        jobId: payload.jobId,
        runId: payload.runId,
        error: payload.error ?? payload.status,
      },
    });
  });
}
