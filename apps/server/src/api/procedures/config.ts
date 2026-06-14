import { Hono } from "hono";
import type { PublicConfig } from "@nama/shared/users";
import { MCP_SCOPES } from "@nama/shared/users";
import { needsBootstrap } from "../../auth";
import { env } from "../../env";

/**
 * Unauthenticated public config endpoint. Exposes the subset of server
 * configuration the client needs before sign-in to gate email-dependent UI
 * (verification banner, change-email, password reset). Intentionally has no
 * auth middleware — the flag is needed pre-session and is not sensitive.
 */
export const configPublicApp = new Hono().get("/", async (c) => {
  const baseUrl = env.APP_EXTERNAL_URL ?? new URL(c.req.url).origin;
  const body: PublicConfig = {
    emailEnabled: env.EMAIL_PROVIDER_CONFIGURED,
    mcpEndpointUrl: `${baseUrl}/mcp`,
    mcpScopes: [...MCP_SCOPES],
    needsBootstrap: await needsBootstrap(),
  };
  return c.json(body);
});
