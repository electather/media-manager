import type { Context, Next, ErrorHandler } from "hono";
import { consola } from "consola";
import { captureError } from "./capture";
import { runWithRequestContext, newRequestId } from "./request-context";
import { HttpError, isExpectedUserError } from "./http-errors";

const REQUEST_ID_HEADER = "x-request-id";

/** Hono middleware that opens a request-scoped AsyncLocalStorage frame with a
 *  request ID (reused from `X-Request-Id` header when present). Also attaches the
 *  same header to the outgoing response for the frontend to echo back. */
export function requestContextMiddleware() {
  return async (c: Context, next: Next): Promise<void> => {
    const incoming = c.req.header(REQUEST_ID_HEADER);
    const requestId = incoming && incoming.length > 0 ? incoming : newRequestId();
    c.set("requestId", requestId);
    try {
      await runWithRequestContext(
        { requestId, userId: null, route: new URL(c.req.url).pathname },
        async () => {
          await next();
        },
      );
    } finally {
      c.res.headers.set(REQUEST_ID_HEADER, requestId);
    }
  };
}

/** Hono `onError` handler that converts thrown errors into the unified JSON
 *  response shape and captures everything 5xx (or un-typed) into the error
 *  store. Expected 4xx (bad input, auth, not-found) is user-product behaviour
 *  and is never captured.
 *
 *  Hono intercepts handler throws internally and routes them here, so this is
 *  the single backend boundary where all errors land. */
export const errorHandler: ErrorHandler = (err, c) => {
  const requestId = (c.get("requestId") as string | undefined) ?? newRequestId();
  const session = c.get("session") as { user?: { id?: string } } | undefined;
  const userId = session?.user?.id ?? null;
  const route = new URL(c.req.url).pathname;

  if (err instanceof HttpError) {
    if (!isExpectedUserError(err.status)) {
      void captureError(err, {
        severity: "error",
        source: "backend",
        code: err.code,
        route,
        userId,
        httpStatus: err.status,
        requestId,
      });
    }
    const status = err.status as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502 | 503;
    return c.json(
      { code: err.code, devMessage: err.message, params: err.params, requestId },
      status,
    );
  }

  consola.error(`[${route}] unhandled error`, err);
  void captureError(err, {
    severity: "error",
    source: "backend",
    code: "http.internal_error",
    route,
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
