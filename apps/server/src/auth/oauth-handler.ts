import { consola } from "consola";
import { auth } from "./config";

async function parseBody(message: Request | Response): Promise<unknown> {
  const ct = message.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) return await message.json().catch(() => null);
  if (ct.includes("application/x-www-form-urlencoded")) {
    const text = await message.text().catch(() => "");
    return Object.fromEntries(new URLSearchParams(text));
  }
  return null;
}

// fallow-ignore-next-line complexity
function jsonToFormParams(json: unknown): Record<string, string> {
  const params: Record<string, string> = {};
  if (json && typeof json === "object") {
    for (const [k, v] of Object.entries(json)) {
      if (v !== null && v !== undefined)
        params[k] =
          typeof v === "object"
            ? JSON.stringify(v)
            : String(v as string | number | boolean | bigint);
    }
  }
  return params;
}

// fallow-ignore-next-line complexity
async function normalizeTokenRequest(req: Request): Promise<Request> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json") || ct.includes("x-www-form-urlencoded")) {
    return req;
  }

  let params: Record<string, string> = {};
  try {
    const json = (await req.clone().json()) as unknown;
    params = jsonToFormParams(json);
  } catch {
    // Empty or unparseable body — let better-auth return a proper OAuth error.
  }

  const newHeaders = new Headers(req.headers);
  newHeaders.set("content-type", "application/x-www-form-urlencoded");
  return new Request(req.url, {
    method: "POST",
    headers: newHeaders,
    body: new URLSearchParams(params).toString(),
  });
}

async function debugLogRequest(path: string, req: Request): Promise<Response> {
  const reqClone = req.clone();
  const reqBody = await parseBody(reqClone);
  consola.debug(`[oauth] → ${path}`, JSON.stringify(reqBody));

  const res = await auth.handler(req);
  const resClone = res.clone();
  const resBody = await parseBody(resClone);
  consola.debug(`[oauth] ← ${path} ${res.status}`, JSON.stringify(resBody));

  return res;
}

/**
 * Handles /api/auth/* requests, normalising application/json bodies on the
 * token endpoint to application/x-www-form-urlencoded. Some MCP clients
 * (e.g. MCP Inspector) send JSON to the token endpoint, which causes a 415
 * that the client treats as a transient failure and retries indefinitely.
 * Converting the body here produces a proper 400 OAuth error instead.
 */
// fallow-ignore-next-line complexity
export async function authRouteHandler(req: Request): Promise<Response> {
  const path = new URL(req.url).pathname;
  const isTokenPath = path.endsWith("/oauth2/token");
  const isDebugPath = path.endsWith("/oauth2/consent") || isTokenPath;

  let normalizedReq = req;
  if (isTokenPath && req.method === "POST") {
    normalizedReq = await normalizeTokenRequest(req);
  }

  if (isDebugPath && normalizedReq.method === "POST") {
    return debugLogRequest(path, normalizedReq);
  }

  return auth.handler(normalizedReq);
}
