import { consola } from "consola";
import type { ErrorRecord } from "@ent-mcp/shared/diagnostics";
import type { DiagnosticSink } from "../diagnostics/types";
import { emit } from "./emit";

/**
 * Captures unhandled critical errors and surfaces them as `system.error`
 * notifications addressed to admins. Filters on severity to avoid storming
 * the admin inbox with expected user-input failures (`info`) or recovered
 * paths (`warning`). Subscribes to error records only — perf records are
 * routed elsewhere (`DatabaseSink`).
 *
 * The sink swallows emit failures via `consola` so a notification path glitch
 * never breaks error capture itself — `captureError` is the last line of
 * defence and must remain reliable.
 */
export class NotificationErrorSink implements DiagnosticSink {
  async captureError(record: ErrorRecord): Promise<void> {
    if (record.severity !== "error") return;

    try {
      await emit({
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
