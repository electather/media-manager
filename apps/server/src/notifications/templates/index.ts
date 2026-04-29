// fallow-ignore-file unused-file
import type { NotificationEvent, NotificationMessage } from "@ent-mcp/shared/notifications";
import { renderJobRunFailed } from "./job-run-failed";

// fallow-ignore-next-line complexity
export function renderTemplate(event: NotificationEvent, _locale: "en"): NotificationMessage {
  switch (event.type) {
    case "job.run.failed":
      return renderJobRunFailed(event);
    case "connection.auth.expired":
      return renderAuthExpired(event);
    case "connection.sync.succeeded":
      return renderSyncSucceeded(event);
    case "media.request.available":
      return renderMediaAvailable(event);
    case "media.request.denied":
      return renderMediaDenied(event);
    case "system.error":
      return renderSystemError(event);
  }
}

function renderAuthExpired(
  event: NotificationEvent & { type: "connection.auth.expired" },
): NotificationMessage {
  return {
    title: "Auth Expired",
    body: `Authentication for ${String(event.payload.pluginId ?? "connection")} expired. Please re-authenticate.`,
    severity: "warn",
    category: "auth",
  };
}

function renderSyncSucceeded(
  event: NotificationEvent & { type: "connection.sync.succeeded" },
): NotificationMessage {
  return {
    title: "Sync Complete",
    body: `Sync completed successfully with ${String(event.payload.itemCount ?? 0)} items.`,
    severity: "info",
    category: "sync",
  };
}

function renderMediaAvailable(
  event: NotificationEvent & { type: "media.request.available" },
): NotificationMessage {
  const msg: NotificationMessage = {
    title: `${String(event.payload.title ?? "Media")} Available`,
    body: "Your requested media is now available.",
    severity: "info",
    category: "media",
  };
  if (event.payload.posterUrl) {
    msg.image = { url: String(event.payload.posterUrl), alt: String(event.payload.title ?? "") };
  }
  return msg;
}

function renderMediaDenied(
  event: NotificationEvent & { type: "media.request.denied" },
): NotificationMessage {
  const reason = event.payload.reason ? `: ${String(event.payload.reason)}` : ".";
  return {
    title: `${String(event.payload.title ?? "Request")} Denied`,
    body: `Your request was denied${reason}`,
    severity: "warn",
    category: "media",
  };
}

function renderSystemError(
  event: NotificationEvent & { type: "system.error" },
): NotificationMessage {
  return {
    title: "System Error",
    body: `${String(event.payload.errorSource ?? "system")}: ${String(event.payload.message ?? "An error occurred")}`,
    severity: "error",
    category: "system",
  };
}
