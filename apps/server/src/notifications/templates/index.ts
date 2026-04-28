// fallow-ignore-file unused-file
import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";
import { renderJobRunFailed } from "./job-run-failed";

export function renderTemplate(event: NotificationEvent, _locale: "en"): NotificationMessage {
  switch (event.type) {
    case "job.run.failed":
      return renderJobRunFailed(event);
    case "connection.auth.expired":
      return {
        title: "Auth Expired",
        body: `Authentication for ${String(event.payload.pluginId ?? "connection")} expired. Please re-authenticate.`,
        severity: "warn",
        category: "auth",
      };
    case "connection.sync.succeeded":
      return {
        title: "Sync Complete",
        body: `Sync completed successfully with ${String(event.payload.itemCount ?? 0)} items.`,
        severity: "info",
        category: "sync",
      };
    case "media.request.available":
      return {
        title: `${String(event.payload.title ?? "Media")} Available`,
        body: "Your requested media is now available.",
        severity: "info",
        category: "media",
        ...(event.payload.posterUrl
          ? {
              image: {
                url: String(event.payload.posterUrl),
                alt: String(event.payload.title ?? ""),
              },
            }
          : {}),
      };
    case "media.request.denied":
      return {
        title: `${String(event.payload.title ?? "Request")} Denied`,
        body: `Your request was denied${event.payload.reason ? `: ${String(event.payload.reason)}` : "."}`,
        severity: "warn",
        category: "media",
      };
    case "system.error":
      return {
        title: "System Error",
        body: `${String(event.payload.errorSource ?? "system")}: ${String(event.payload.message ?? "An error occurred")}`,
        severity: "error",
        category: "system",
      };
  }
}
