import type { ErrorReportPayload, ErrorSeverity } from "@nama/shared/diagnostics";
import { authClient } from "@/shared/lib/auth";
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

/** Frontend error capture. POST to `/api/diagnostics/errors`, threading `X-Request-Id`
 *  from DOM to chain with Hono RPC call. Swallows transport failures. Does NOT use
 *  `window.location.pathname` as route (needs parameterized TanStack pattern `/movie/$id`).
 */
export async function reportError(
  err: unknown,
  severity: ErrorSeverity,
  context?: ErrorReportPayload["context"],
  code?: string,
): Promise<void> {
  try {
    // Endpoint requires a session; skip pre-auth (e.g. /bootstrap, /auth/login) to
    // avoid a guaranteed 401. See issue for capturing pre-auth crashes long-term.
    const { data: session } = await authClient.getSession();
    if (!session) return;
    const requestId = document.documentElement.dataset.requestId;
    const payload: ErrorReportPayload = {
      severity,
      code,
      context,
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
