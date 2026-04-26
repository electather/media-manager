import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";
import { renderJobRunFailed } from "./job-run-failed";

export function renderTemplate(event: NotificationEvent, _locale: "en"): NotificationMessage {
  switch (event.type) {
    case "job.run.failed":
      return renderJobRunFailed(event as any);
    case "connection.auth.expired":
      return {
        title: "Auth Expired",
        body: `Authentication for connection expired. Please re-authenticate.`,
        severity: "warn",
        category: "auth",
      };
    case "connection.sync.succeeded":
      return {
        title: "Sync Complete",
        body: `Sync completed successfully with ${event.payload.itemCount} items.`,
        severity: "info",
        category: "sync",
      };
    case "media.request.available":
      return {
        title: `${event.payload.title} Available`,
        body: "Your requested media is now available.",
        severity: "info",
        category: "media",
      };
    case "media.request.denied":
      return {
        title: `${event.payload.title} Request Denied`,
        body: `Your request was denied${event.payload.reason ? `: ${event.payload.reason}` : "."}`,
        severity: "warn",
        category: "media",
      };
    case "system.error":
      return {
        title: "System Error",
        body: event.payload.message,
        severity: "error",
        category: "system",
      };
  }
}
