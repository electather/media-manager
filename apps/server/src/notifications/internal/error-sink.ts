import { consola } from "consola";
import type { ErrorRecord } from "@nama/shared/diagnostics";
import type { NotificationEvent } from "@nama/shared/notifications";
import type { DiagnosticSink } from "../../diagnostics/types";

/**
 * Diagnostic sink that turns critical errors into `system.error` notifications
 * addressed to admins. Filters on severity so the admin inbox is not stormed
 * by expected user-input failures (`info`) or recovered paths (`warning`).
 *
 * The publish callback is injected through the constructor so this file stays
 * free of any import on `../service` — avoids a static cycle between
 * `service.ts → internal/error-sink.ts → service.ts`.
 */
export class NotificationErrorSink implements DiagnosticSink {
  constructor(
    private readonly publish: (
      event: Omit<NotificationEvent, "id" | "occurredAt">,
    ) => Promise<void>,
  ) {}

  async captureError(record: ErrorRecord): Promise<void> {
    if (record.severity !== "error") return;
    try {
      await this.publish({
        type: "system.error",
        category: "system",
        severity: "error",
        audience: { kind: "admin", permission: "admin:server" },
        payload: {
          errorSource: record.source,
          message: record.devMessage,
        },
        ...(record.requestId ? { correlationKey: record.requestId } : {}),
      });
    } catch (err) {
      consola.error("[notifications] system.error emit failed:", err);
    }
  }
}
