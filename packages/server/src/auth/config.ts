import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getDb } from "../db/client";
import { env } from "../env";
import { MCP_SCOPES } from "../mcp/scopes";
import * as schema from "../db/schema/index";
import { hashPassword, verifyPassword } from "./password";

export const auth = betterAuth({
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  trustedOrigins: env.BETTER_AUTH_TRUSTED_ORIGINS
    ? env.BETTER_AUTH_TRUSTED_ORIGINS.split(",").map((o) => o.trim())
    : [],
  database: drizzleAdapter(getDb(), {
    provider: "sqlite",
    schema: {
      ...schema,
    },
  }),
  emailAndPassword: {
    enabled: true,
    // See `./password.ts`. Override better-auth's default scrypt because on
    // Cloudflare Workers scrypt's memory cost pushes `sign-in/email` past
    // the 30 s isolate CPU limit.
    password: {
      hash: hashPassword,
      verify: verifyPassword,
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/auth/login",
      consentPage: "/oauth/consent",
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Accept both trailing-slash and non-trailing-slash forms of the base URL,
      // since MCP clients derive the resource indicator from discovery metadata
      // and may append a trailing slash.
      validAudiences: [env.BETTER_AUTH_URL],
      advertisedMetadata: {
        scopes_supported: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      },
    }),
  ],
  experimental: {
    joins: true,
  },
});

export type Auth = typeof auth;
