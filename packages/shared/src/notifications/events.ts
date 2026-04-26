import type { NotificationEventEnvelope } from "./types";

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
