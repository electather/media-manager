import {
  type NotificationCategory,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationSeverity,
} from "@nama/shared/notifications";

export const EVENT_TYPE_META: Record<
  NotificationEventType,
  { category: NotificationCategory; severity: NotificationSeverity }
> = {
  "media.request.available": { category: "media", severity: "info" },
  "media.request.denied": { category: "media", severity: "warn" },
  "connection.auth.expired": { category: "auth", severity: "warn" },
  "connection.sync.succeeded": { category: "sync", severity: "info" },
  "job.run.failed": { category: "system", severity: "error" },
  "system.error": { category: "system", severity: "error" },
};

// fallow-ignore-next-line complexity
export function buildEvent(
  eventType: NotificationEventType,
  userId: string,
): Omit<NotificationEvent, "id" | "occurredAt"> {
  const meta = EVENT_TYPE_META[eventType];
  const audience = { kind: "user" as const, userId };
  switch (eventType) {
    case "media.request.available":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { requestId: `demo-${Date.now()}`, mediaId: "demo", title: "Demo media" },
      };
    case "media.request.denied":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: {
          requestId: `demo-${Date.now()}`,
          mediaId: "demo",
          title: "Demo media",
          reason: "demo denial",
        },
      };
    case "connection.auth.expired":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { connectionId: "demo-connection", pluginId: "demo-plugin" },
      };
    case "connection.sync.succeeded":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { connectionId: "demo-connection", pluginId: "demo-plugin", itemCount: 42 },
      };
    case "job.run.failed":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { jobId: "demo.job", runId: "demo-run", error: "demo error" },
      };
    case "system.error":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { errorSource: "demo", message: "Demo notification triggered by admin" },
      };
  }
}
