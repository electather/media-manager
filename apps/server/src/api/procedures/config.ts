import { Hono } from "hono";
import type { PublicConfig } from "@ent-mcp/shared/users";
import { MCP_SCOPES } from "@ent-mcp/shared/users";
import { env } from "../../env";

/**
 * Unauthenticated public config endpoint. Exposes the subset of server
 * configuration the client needs before sign-in to gate email-dependent UI
 * (verification banner, change-email, password reset). Intentionally has no
 * auth middleware — the flag is needed pre-session and is not sensitive.
 */
export const configPublicApp = new Hono().get("/", (c) => {
  const baseUrl = env.APP_EXTERNAL_URL ?? new URL(c.req.url).origin;
  const body: PublicConfig = {
    emailEnabled: env.EMAIL_PROVIDER_CONFIGURED,
    mcpEndpointUrl: `${baseUrl}/mcp`,
    mcpScopes: [...MCP_SCOPES],
  };
  return c.json(body);
});
