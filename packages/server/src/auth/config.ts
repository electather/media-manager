import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { mcp } from "better-auth/plugins";
import { getDb } from "../db/client";
import { env } from "../env";
import { MCP_SCOPES } from "../mcp/scopes";
import * as schema from "../db/schema/index";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS
    ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [],
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: {
      user: schema.user,
      session: schema.session,
      account: schema.account,
      verification: schema.verification,
    },
  }),
  emailAndPassword: {
    enabled: true,
  },
  plugins: [
    mcp({
      loginPage: "/auth/login",
      resource: env.BETTER_AUTH_URL,
      oidcConfig: {
        loginPage: "/auth/login",
        consentPage: "/oauth/consent",
        scopes: [...MCP_SCOPES],
      },
    }),
  ],
});

export type Auth = typeof auth;
