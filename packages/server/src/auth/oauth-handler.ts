import { consola } from "consola";
import { auth } from "./config";

/**
 * Handles /api/auth/* requests, normalising application/json bodies on the
 * token endpoint to application/x-www-form-urlencoded. Some MCP clients
 * (e.g. MCP Inspector) send JSON to the token endpoint, which causes a 415
 * that the client treats as a transient failure and retries indefinitely.
 * Converting the body here produces a proper 400 OAuth error instead.
 */
export async function authRouteHandler(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const isTokenPath = path.endsWith("/oauth2/token");
  const isDebugPath = path.endsWith("/oauth2/consent") || isTokenPath;

  let normalizedReq = req;
  if (isTokenPath && req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json") && !ct.includes("x-www-form-urlencoded")) {
      let params: Record<string, string> = {};
      try {
        const json = (await req.clone().json()) as Record<string, unknown>;
        if (json && typeof json === "object") {
          for (const [k, v] of Object.entries(json)) {
            if (v !== null && v !== undefined)
              params[k] =
                typeof v === "object"
                  ? JSON.stringify(v)
                  : String(v as string | number | boolean | bigint);
          }
        }
      } catch {
        // Empty or unparseable body — let better-auth return a proper OAuth error.
      }
      const newHeaders = new Headers(req.headers);
      newHeaders.set("content-type", "application/x-www-form-urlencoded");
      normalizedReq = new Request(req.url, {
        method: "POST",
        headers: newHeaders,
        body: new URLSearchParams(params).toString(),
      });
    }
  }

  if (isDebugPath && normalizedReq.method === "POST") {
    const clone = normalizedReq.clone();
    const ct = clone.headers.get("content-type") ?? "";
    let body: unknown;
    if (ct.includes("application/json")) body = await clone.json().catch(() => null);
    else if (ct.includes("application/x-www-form-urlencoded")) {
      const text = await clone.text().catch(() => "");
      body = Object.fromEntries(new URLSearchParams(text));
    }
    consola.debug(`[oauth] → ${path}`, JSON.stringify(body));
    const res = await auth.handler(normalizedReq);
    const resClone = res.clone();
    const resBody = await resClone.json().catch(() => null);
    consola.debug(`[oauth] ← ${path} ${res.status}`, JSON.stringify(resBody));
    return res;
  }

  return auth.handler(normalizedReq);
}
