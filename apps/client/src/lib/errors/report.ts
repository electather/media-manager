import type { ErrorReportPayload, ErrorSeverity } from "@ent-mcp/shared/errors";
import { REQUEST_ID_HEADER } from "./request-id";

function serialize(err: unknown): Pick<ErrorReportPayload, "name" | "message" | "stack"> {
  if (err instanceof Error) {
    return { name: err.name, message: err.message, stack: err.stack };
  }
  return {
    message:
      typeof err === "string"
        ? err
        : (() => {
            try {
              return JSON.stringify(err);
            } catch {
              return String(err);
            }
          })(),
  };
}

/** Frontend-side error capture. Fires a fire-and-forget POST to /api/errors with the
 *  serialized error and a request id header. Swallows transport failures intentionally —
 *  we never want "error capture failed" to surface in the UI. */
export async function reportError(
  err: unknown,
  severity: ErrorSeverity,
  context?: Record<string, unknown>,
  code?: string,
): Promise<void> {
  try {
    const payload: ErrorReportPayload = {
      severity,
      code,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      context,
      ...serialize(err),
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    // Thread any ambient request id off the DOM so the record chains with the oRPC call
    // that triggered the surfaced error (see request-id.ts writes on every fetch).
    const current = document.documentElement.dataset.requestId;
    if (current) headers[REQUEST_ID_HEADER] = current;
    await fetch("/api/errors", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // Intentionally swallowed. See docstring.
  }
}
