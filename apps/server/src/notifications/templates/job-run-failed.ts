import type { NotificationMessage, NotificationEvent } from "@ent-mcp/shared/notifications";

export function renderJobRunFailed(
  event: Extract<NotificationEvent, { type: "job.run.failed" }>,
): NotificationMessage {
  return {
    title: "Job Failed",
    body: `Job ${event.payload.jobId} failed: ${event.payload.error}`,
    severity: "error",
    category: "system",
  };
}
