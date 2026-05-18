import { consola } from "consola";
import { verifyAccessToken } from "better-auth/oauth2";
import { env } from "../env";
import { parseScopes } from "./scopes";

/**
 * Verifies the Bearer token from the Authorization header using the OAuth 2.1
 * provider's JWT verification and calls the handler with the resolved userId
 * and scopes.
 */
export async function withOAuthAuth(
  req: Request,
  handler: (req: Request, userId: string, scopes: string[]) => Promise<Response>,
): Promise<Response> {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "unauthorized", error_description: "Bearer token required." }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": "Bearer",
        },
      },
    );
  }

  const accessToken = authorization.slice(7);
  const baseUrl = env.BETTER_AUTH_URL.replace(/\/$/, "");
  try {
    const payload = await verifyAccessToken(accessToken, {
      jwksUrl: `${baseUrl}/api/auth/jwks`,
      verifyOptions: {
        // Better-auth sets iss to baseURL + "/api/auth".
        issuer: `${baseUrl}/api/auth`,
        // MCP clients always send the resource with a trailing slash.
        audience: `${baseUrl}/`,
      },
    });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      throw new Error("missing or invalid sub claim");
    }
    if (payload.scope !== undefined && typeof payload.scope !== "string") {
      throw new Error("invalid scope claim type");
    }
    const userId = payload.sub;
    const scopes = parseScopes(payload.scope as string | undefined);
    consola.debug("[mcp-auth] token verified", { userId, scopes });
    return handler(req, userId, scopes);
  } catch (err) {
    consola.warn("[mcp-auth] token verification failed", err instanceof Error ? err.message : err);
    return new Response(
      JSON.stringify({ error: "invalid_token", error_description: "Token verification failed." }),
      {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": 'Bearer error="invalid_token"',
        },
      },
    );
  }
}
