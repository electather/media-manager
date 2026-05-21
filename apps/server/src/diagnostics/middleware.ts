import type { Context, Next, ErrorHandler } from "hono";
import { consola } from "consola";
import { captureError, capturePerf } from "./capture";
import { runWithRequestContext, newRequestId } from "./request-context";
import { HttpError, isExpectedUserError } from "./http-errors";

const REQUEST_ID_HEADER = "x-request-id";
// Accepts request IDs that are 1–64 characters of alphanumeric, hyphen, or underscore only.
// Rejects anything else (oversized, path-injection chars, etc.) and falls back to a generated ID.
const REQUEST_ID_PATTERN = /^[0-9a-zA-Z_-]{1,64}$/;

/** Hono middleware that opens a request-scoped AsyncLocalStorage frame with a
 *  request ID (reused from `X-Request-Id` header when present). Also attaches the
 *  same header to the outgoing response for the frontend to echo back.
 *
 *  The frame's `route` field is left null on entry — Hono's matched
 *  `routePath` is only available *after* the router resolves the request,
 *  so callers that need a parameterised route (the perf middleware, the
 *  errorHandler) read it directly from `c.req.routePath`. Storing the raw
 *  URL pathname here would persist `/admin/plugins/trakt`-shaped values
 *  into the diagnostics tables and blow row cardinality (one row per
 *  distinct id), violating the design-doc invariant `route ⊥ raw URL`. */
export function requestContextMiddleware() {
  return async (c: Context, next: Next): Promise<void> => {
    const raw = c.req.header(REQUEST_ID_HEADER);
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

/** Hono middleware that times each handled request and writes one perf row per
 *  matched route. Skips unmatched routes (so static / 404 / pre-router throws
 *  never surface), every diagnostics namespace (`/api/diagnostics`,
 *  `/api/admin/diagnostics`, and the equivalents relative to the API router —
 *  see {@link isDiagnosticsRoute}) so polling the admin Performance tab does
 *  not feed itself, and streaming responses (no useful single duration).
 *
 *  Must run inside the request-context frame so `requestId` is available; the
 *  perf row inherits that id and chains to any error captured for the same
 *  request. */
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

/** Hono `onError` handler that converts thrown errors into the unified JSON
 *  response shape and captures everything 5xx (or un-typed) into the error
 *  store. Expected 4xx (bad input, auth, not-found) is user-product behaviour
 *  and is never captured.
 *
 *  Hono intercepts handler throws internally and routes them here, so this is
 *  the single backend boundary where all errors land. */
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
      devMessage: err instanceof Error ? err.message : String(err),
      requestId,
    },
    500,
  );
};
