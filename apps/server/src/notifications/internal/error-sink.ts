import { consola } from "consola";
import type { ErrorRecord } from "@nama/shared/diagnostics";
import type { NotificationEvent } from "@nama/shared/notifications";
import type { DiagnosticSink } from "../../diagnostics/types";

/**
 * Diagnostic sink: critical errors → `system.error` notifications to admins (filters `info`/`warning`).
 * Injected publish callback avoids static cycle with `service.ts`.
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
