import { pluginError, handleHttpStatus } from "@nama/plugin-sdk";
import type { Ctx } from "./types";
import { BASE } from "./constants";

function traktHeaders(ctx: Ctx): Record<string, string> {
  const clientId = ctx.sharedCredentials?.clientId;
  if (!clientId) {
    throw pluginError("plugin.bad_credentials", "Trakt clientId not configured by admin");
  }
  const h: Record<string, string> = {
    "content-type": "application/json",
    "trakt-api-version": "2",
    "trakt-api-key": clientId,
  };
  if (ctx.credentials?.accessToken) {
    h["Authorization"] = `Bearer ${ctx.credentials.accessToken}`;
  }
  return h;
}

export async function traktFetch(
  ctx: Ctx,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = { ...traktHeaders(ctx), ...(init.headers as Record<string, string>) };
  return ctx.fetch(`${BASE}${path}`, { ...init, headers });
}

export async function traktJson<T>(ctx: Ctx, path: string, init: RequestInit = {}): Promise<T> {
  const res = await traktFetch(ctx, path, init);
  handleHttpStatus(res, "Trakt", { on401: "plugin.token_expired" });
  if (!res.ok)
    throw pluginError("plugin.upstream_error", `Trakt ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

// Fetches all pages of a paginated endpoint concurrently after reading the
// page count from the first response's X-Pagination-Page-Count header.
export async function traktPaginate<T>(ctx: Ctx, basePath: string): Promise<T[]> {
  const PAGE_SIZE = 1000;
  const sep = basePath.includes("?") ? "&" : "?";
  const firstRes = await traktFetch(ctx, `${basePath}${sep}page=1&limit=${PAGE_SIZE}`);
  handleHttpStatus(firstRes, "Trakt", { on401: "plugin.token_expired" });
  if (!firstRes.ok)
    throw pluginError(
      "plugin.upstream_error",
      `Trakt ${firstRes.status}: ${await firstRes.text()}`,
    );
  // Guard against malformed or missing X-Pagination-Page-Count headers; falling
  // through to NaN would silently truncate to a single page.
  const headerCount = Number(firstRes.headers.get("X-Pagination-Page-Count"));
  const pageCount = Number.isFinite(headerCount) && headerCount >= 1 ? headerCount : 1;
  const firstPage = (await firstRes.json()) as T[];
  if (pageCount <= 1) return firstPage;
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, i) =>
      traktJson<T[]>(ctx, `${basePath}${sep}page=${i + 2}&limit=${PAGE_SIZE}`),
    ),
  );
  return ([] as T[]).concat(firstPage, ...rest);
}
