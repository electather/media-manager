import type { ErrorReportPayload, ErrorSeverity } from "@ent-mcp/shared/diagnostics";
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

/** Frontend-side error capture. Fires a fire-and-forget POST to
 *  `/api/diagnostics/errors` with the serialized error. Threads any ambient
 *  request id off the DOM so the record chains with the Hono RPC call that
 *  triggered it — sent both as the `X-Request-Id` header and inside the body
 *  so the server picks it up even when the AsyncLocalStorage frame is missing
 *  (e.g. global window.error fires outside an RPC). Swallows transport
 *  failures intentionally — we never want "error capture failed" to surface
 *  in the UI. */
export async function reportError(
  err: unknown,
  severity: ErrorSeverity,
  context?: Record<string, unknown>,
  code?: string,
): Promise<void> {
  try {
    const requestId = document.documentElement.dataset.requestId;
    const payload: ErrorReportPayload = {
      severity,
      code,
      route: typeof window !== "undefined" ? window.location.pathname : undefined,
      context,
      ...(requestId ? { requestId } : {}),
      ...serialize(err),
    };
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;
    await fetch("/api/diagnostics/errors", {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
  } catch {
    // Intentionally swallowed. See docstring.
  }
}
