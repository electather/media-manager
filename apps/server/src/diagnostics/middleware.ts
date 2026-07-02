import type { Context, Next, ErrorHandler } from "hono";
import { consola } from "consola";
import { REQUEST_ID_PATTERN } from "@nama/shared/diagnostics";
import { captureError, capturePerf } from "./capture";
import { runWithRequestContext, newRequestId } from "./request-context";
import { HttpError, isExpectedUserError, isNoConnectionError } from "./http-errors";

const REQUEST_ID_HEADER = "x-request-id";

/** Opens a request-scoped AsyncLocalStorage frame with request ID (reused from `x-request-id` header).
 *  Sets frame.route=null (Hono's routePath unavailable until after router); callers read `c.req.routePath` directly.
 *  Avoids persisting raw URLs (`/admin/plugins/trakt`) to preserve cardinality and invariant `route ⊥ raw URL`. */
export function requestContextMiddleware() {
  return async (c: Context, next: Next): Promise<void> => {
    const raw = c.req.header(REQUEST_ID_HEADER);
    // Accepts 1–64 chars of alphanumeric, hyphen, or underscore; falls back to a generated ID.
    const requestId = raw && REQUEST_ID_PATTERN.test(raw) ? raw : newRequestId();
    c.set("requestId", requestId);
    try {
      await runWithRequestContext({ requestId, userId: null, route: null }, async () => {
        await next();
      });
    } finally {
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
    }
  };
}

/** Times each request and writes perf row per matched route.
 *  Skips unmatched, diagnostics namespaces (isDiagnosticsRoute), and streaming responses.
 *  Runs inside request-context frame so perf row inherits requestId and chains to error captures. */
export function httpPerfMiddleware() {
  // Middleware filter chain (route + recursion guard + streaming guard +
  // session lookup) is intrinsic.
  // fallow-ignore-next-line complexity
  return async (c: Context, next: Next): Promise<void> => {
    const t0 = Date.now();
    try {
      await next();
    } finally {
      const route = c.req.routePath;
      if (
        route &&
        route !== "*" &&
        route !== "/*" &&
        !isDiagnosticsRoute(route) &&
        !isStreamingResponse(c)
      ) {
        const session = c.get("session") as { user?: { id?: string } } | undefined;
        void capturePerf({
          kind: "http",
          route,
          method: c.req.method,
          status: c.res.status,
          durationMs: Date.now() - t0,
          userId: session?.user?.id ?? null,
        });
      }
    }
  };
}

/** Recursion guard for the perf middleware. `routePath` is the matched pattern
 *  in the sub-app where the route was registered, so for the appRouter mount
 *  (`/api`) it can arrive either as the full URL pattern (when middleware runs
 *  on the outer app, e.g. tests) or relative to the router (production). Cover
 *  both shapes so the admin Performance tab does not record its own polling. */
function isDiagnosticsRoute(route: string): boolean {
  return (
    route.startsWith("/api/diagnostics") ||
    route.startsWith("/api/admin/diagnostics") ||
    route.startsWith("/diagnostics") ||
    route.startsWith("/admin/diagnostics")
  );
}

function isStreamingResponse(c: Context): boolean {
  const ct = c.res.headers.get("content-type");
  if (!ct) return false;
  return ct.startsWith("text/event-stream") || ct.startsWith("application/octet-stream");
}

/** Converts throws to unified JSON shape. Captures 5xx (or untyped); skips expected 4xx.
 *  Single backend boundary where all errors land (Hono internally intercepts handler throws). */
// fallow-ignore-next-line complexity
export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = (c.get("requestId") as string | undefined) ?? newRequestId();
  const session = c.get("session") as { user?: { id?: string } } | undefined;
  const userId = session?.user?.id ?? null;
  // Prefer the matched Hono pattern (e.g. `/api/connections/:id`) over the
  // raw URL path so the diagnostics table groups errors by route shape, not
  // per-id. `routePath` is undefined for unmatched requests (404 / pre-router
  // throws), in which case we record null rather than the raw path.
  const matchedRoute = c.req.routePath;
  const route = matchedRoute && matchedRoute !== "*" && matchedRoute !== "/*" ? matchedRoute : null;

  // media.no_connection = no provider configured for requested capability (expected user state).
  // Service callers normally swallow it, but missed ones return 200 (not 500) with structured no-provider body.
  // Matched structurally (isNoConnectionError) so infra never imports media module; no devMessage leaked on public surface.
  if (isNoConnectionError(err)) {
    return c.json(
      {
        code: err.code,
        pluginId: err.pluginId,
        requestId,
      },
      200,
    );
  }

  if (err instanceof HttpError) {
    if (!isExpectedUserError(err.status)) {
      void captureError(err, {
        severity: "error",
        source: "backend",
        code: err.code,
        route: route ?? undefined,
        userId,
        httpStatus: err.status,
        requestId,
      });
    }
    const status = err.status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503;
    return c.json(
      {
        code: err.code,
        devMessage: err.message,
        params: err.params,
        details: err.details,
        requestId,
      },
      status,
    );
  }

  consola.error(`[${route ?? c.req.path}] unhandled error`, err);
  void captureError(err, {
    severity: "error",
    source: "backend",
    code: "http.internal_error",
    route: route ?? undefined,
    userId,
    httpStatus: 500,
    requestId,
  });
  return c.json(
    {
      code: "http.internal_error",
      devMessage: "An unexpected error occurred.",
      requestId,
    },
    500,
  );
};
