import { hc } from "hono/client";
import type { AppType } from "@ent-mcp/server/api/router";
import { REQUEST_ID_HEADER } from "./errors/request-id";
import { reportError } from "./errors/report";

/** Custom fetch used by the Hono RPC client. Stamps a request id on every outbound
 *  request, records the echoed request id on the DOM so reportError can chain, and
 *  reports non-2xx responses as "warning" severity — the backend has already written
 *  the authoritative record, so we just note "the user saw this error". */
async function instrumentedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  let requestId = headers.get(REQUEST_ID_HEADER);
  if (!requestId) {
    requestId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `rid_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
    headers.set(REQUEST_ID_HEADER, requestId);
  }
  const response = await fetch(input, { ...init, headers });
  const echoed = response.headers.get(REQUEST_ID_HEADER) ?? requestId;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.requestId = echoed;
  }
  if (!response.ok) {
    // Skip reporting self-hits on /api/errors to prevent loops.
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
    if (!url.includes("/api/errors")) {
      void reportError(new Error(`API ${response.status} for ${url}`), "warning", {
        url,
        status: response.status,
      });
    }
  }
  return response;
}

/** Typed Hono RPC client pointing at the server's /api endpoint. */
export const api = hc<AppType>("/api", { fetch: instrumentedFetch });
