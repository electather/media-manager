import type { NotificationMessage, NotificationEvent } from "@nama/shared/notifications";

export function renderJobRunFailed(
  event: Extract<NotificationEvent, { type: "job.run.failed" }>,
): NotificationMessage {
  return {
    title: "Job Failed",
    body: `Job ${String(event.payload.jobId ?? "?")} failed: ${String(event.payload.error ?? "unknown error")}`,
    severity: "error",
    category: "system",
  };
}
