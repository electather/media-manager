import type { NotificationEventEnvelope } from "./types";

export const NOTIFICATION_EVENT_TYPES = [
  "job.run.failed",
  "connection.auth.expired",
  "connection.sync.succeeded",
  "media.request.available",
  "media.request.denied",
  "system.error",
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export type NotificationEvent =
  | NotificationEventEnvelope<"job.run.failed", { jobId: string; runId: string; error: string }>
  | NotificationEventEnvelope<"connection.auth.expired", { connectionId: string; pluginId: string }>
  | NotificationEventEnvelope<
      "connection.sync.succeeded",
      { connectionId: string; pluginId: string; itemCount: number }
    >
  | NotificationEventEnvelope<
      "media.request.available",
      { requestId: string; mediaId: string; title: string; posterUrl?: string }
    >
  | NotificationEventEnvelope<
      "media.request.denied",
      { requestId: string; mediaId: string; title: string; posterUrl?: string; reason?: string }
    >
  | NotificationEventEnvelope<"system.error", { errorSource: string; message: string }>;
