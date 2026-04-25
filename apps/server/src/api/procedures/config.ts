import { Hono } from "hono";
import type { PublicConfig } from "@ent-mcp/shared/users";
import { env } from "../../env";

/**
 * Unauthenticated public config endpoint. Exposes the subset of server
 * configuration the client needs before sign-in to gate email-dependent UI
 * (verification banner, change-email, password reset). Intentionally has no
 * auth middleware — the flag is needed pre-session and is not sensitive.
 */
export const configPublicApp = new Hono().get("/", (c) => {
  const body: PublicConfig = { emailEnabled: env.EMAIL_PROVIDER_CONFIGURED };
  return c.json(body);
});
