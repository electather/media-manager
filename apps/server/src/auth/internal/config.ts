import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { customSession, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { loadUserPermissions } from "../repo";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { env } from "../../env";
import { MCP_SCOPES } from "@ent-mcp/shared/users";
import * as schema from "../../db/schema/index";
import { user } from "../../db/schema/auth";
import { sendEmail } from "./email";
import { createEmailChangeHooks } from "./email-change-hooks";

// Strip any trailing slashes from the configured base URL so we can derive
// both audience forms (with and without trailing slash) from one source. The
// MCP verifier in mcp/auth.ts must accept the same set.
const normalisedBaseUrl = env.BETTER_AUTH_URL.replace(/\/+$/, "");

const emailChangeHooks = createEmailChangeHooks({
  readUserEmail: async (id) => {
    const row = await getDb().select({ email: user.email }).from(user).where(eq(user.id, id)).get();
    return row?.email ?? null;
  },
  sendEmail,
});

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
  // Cache the resolved session in a signed cookie for 5 minutes so per-call
  // auth checks (e.g. one per artwork RPC) don't fan out into a DB round
  // trip. Permission checks still hit the DB via requirePermission.
  //
  // Tradeoff: a session revoked or invalidated mid-window stays valid until
  // the cookie expires (`maxAge` seconds). `requirePermission` still
  // validates against the DB, so elevated operations cannot ride a stale
  // cache; only the basic authenticated check trails by up to 5 minutes.
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  emailAndPassword: {
    enabled: true,
  },
  emailVerification: {
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail({
        to: user.email,
        subject: "Verify your email",
        text: `Click to verify: ${url}`,
      });
    },
  },
  user: {
    changeEmail: {
      enabled: true,
      // When the deployment has email wired up, the verification link goes
      // to the user's CURRENT (old) address — the email only flips after
      // that link is clicked. When email is off (self-hosted without a
      // provider), leaving this undefined makes Better Auth flip the email
      // immediately, matching the design's "no verification email will be
      // sent" disabled-mode flow.
      sendChangeEmailConfirmation: env.EMAIL_PROVIDER_CONFIGURED
        ? async ({ user, newEmail, url }) => {
            await sendEmail({
              to: user.email,
              subject: "Approve email change",
              text: `Click to approve changing your email to ${newEmail}: ${url}`,
            });
          }
        : undefined,
    },
  },
  // Better Auth 1.6 has no built-in post-switch notification for an email
  // change, so we synthesise one via the user-update database hook. See
  // ./email-change-hooks.ts for the rationale and tradeoffs (memory, concurrency,
  // why the session id is the only viable target-id source inside the hook).
  databaseHooks: {
    user: {
      update: emailChangeHooks,
    },
  },
  plugins: [
    customSession(async ({ user, session }) => {
      const permissions = await loadUserPermissions(user.id);
      return { session, user, permissions };
    }),
    jwt(),
    oauthProvider({
      loginPage: "/auth/login",
      consentPage: "/oauth/consent",
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      allowDynamicClientRegistration: true,
      // Endpoint-only MCP clients (Claude/Cursor/generic) bootstrap from the
      // bare `/mcp` URL and rely on unauthenticated RFC 7591 registration to
      // obtain a client id before the user can authorize. Requiring auth here
      // would break first-connect for every MCP client we ship docs for.
      // Abuse is bounded by the rate limit below, which the better-auth
      // oauth-provider applies per IP at the framework layer.
      allowUnauthenticatedClientRegistration: true,
      // Cap dynamic client registration at 5 requests per hour per IP.
      // The default is 5/minute, which is too generous for an unauthenticated
      // write endpoint; honest MCP clients only register once per install.
      // Accepted trade-off: users sharing a single egress IP (corporate NAT,
      // home router during simultaneous onboarding) can hit the cap. For a
      // single-tenant personal media manager the abuse-prevention value
      // outweighs the rare onboarding-storm cost; revisit if/when a multi-
      // tenant deployment surfaces.
      rateLimit: {
        register: { window: 60 * 60, max: 5 },
      },
      // Accept both trailing-slash and non-trailing-slash forms of the base URL,
      // since MCP clients derive the resource indicator from discovery metadata
      // and may append a trailing slash.
      validAudiences: [normalisedBaseUrl, `${normalisedBaseUrl}/`],
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
