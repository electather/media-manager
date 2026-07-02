import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { createAuthMiddleware } from "better-auth/api";
import { customSession, jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { loadUserPermissions } from "../repo";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { env } from "../../env";
import { MCP_SCOPES, NAME_MAX_LENGTH, truncateName } from "@nama/shared/users";
import * as schema from "../../db/schema/index";
import { user } from "../../db/schema/auth";
import { sendEmail } from "./email";
import { createEmailChangeHooks } from "./email-change-hooks";
import { enforcePasswordPolicy } from "./password-policy-hook";

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

// All Better Auth options EXCEPT the customSession plugin. Extracted so the
// same object can be passed as the second argument to `customSession(fn,
// options)`, which is what lets it infer `user.additionalFields` (e.g.
// `hasOnboarded`) onto the resolved session type.
const options = {
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
  // Cache the resolved session in a signed cookie (5 min) so Better Auth's own /get-session
  // route can answer client polling without a DB round-trip. Server-side authorization does NOT
  // ride this cache: requireSession passes disableCookieCache so a force sign-out (revoke-sessions)
  // is enforced on the next request rather than after cookie expiry (#926).
  session: {
    cookieCache: { enabled: true, maxAge: 5 * 60 },
  },
  // Better Auth's changePassword endpoint never runs `passwordSchema` on the new password, so a
  // crafted authClient.changePassword call could bypass the client-side policy (#879). Re-validate
  // server-side in the request before-hook; see ./password-policy-hook.ts.
  hooks: {
    before: createAuthMiddleware(enforcePasswordPolicy),
  },
  emailAndPassword: {
    enabled: true,
    // Close the public sign-up route. Sign-in stays enabled; the only path to
    // the first user is the token-gated POST /api/bootstrap/claim. Without this
    // an attacker could POST to sign-up on a fresh install and flip
    // needsBootstrap to false, locking the operator out of /bootstrap.
    disableSignUp: true,
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
    additionalFields: {
      // `input: false` so `hasOnboarded` can never be set through Better Auth's
      // create/update input — it flips only via the server-authoritative
      // markUserOnboarded path. This is load-bearing: a client-supplied flag
      // would trivially bypass the TMDB-required onboarding gate.
      hasOnboarded: { type: "boolean", input: false, defaultValue: false },
    },
    changeEmail: {
      enabled: true,
      // Verification link goes to the CURRENT (old) address; the email only flips after it's clicked.
      // When email is off, leaving this undefined makes Better Auth flip immediately — matching the
      // "no verification email will be sent" disabled-mode flow.
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
      create: {
        // Social/OAuth providers supply the user's display name from their
        // profile without any length gate. Silently truncate names that exceed
        // NAME_MAX_LENGTH so they fit the validated DB column without blocking
        // sign-up — the user can rename themselves to anything ≤100 chars after
        // logging in.
        before: async (userData) => {
          if (typeof userData.name === "string" && userData.name.length > NAME_MAX_LENGTH) {
            return { data: { ...userData, name: truncateName(userData.name) } };
          }
          // Returning nothing tells Better Auth to proceed with the row
          // unchanged, avoiding a needless shallow clone on every social
          // sign-up. See node_modules/better-auth dist/db/with-hooks.mjs:
          // a non-object result leaves the create payload untouched.
          return;
        },
      },
      update: emailChangeHooks,
    },
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/auth/login",
      consentPage: "/oauth/consent",
      scopes: ["openid", "profile", "email", "offline_access", ...MCP_SCOPES],
      allowDynamicClientRegistration: true,
      // MCP clients (Claude/Cursor/generic) need unauthenticated RFC 7591 registration to get a
      // client id before the user can authorize — requiring auth here breaks first-connect.
      // Abuse bounded by: per-IP rate limit (below) + stale-client sweep (auth/jobs/stale-client-sweep.ts)
      // which deletes unauthorized clients after the TTL. Residual risk: rotating-IP attacker can
      // accumulate up to one TTL window of unauthorized clients between sweeps.
      allowUnauthenticatedClientRegistration: true,
      // 5/hour (not the 5/minute default) — honest MCP clients register once per install.
      // Tradeoff: shared-egress IPs (corporate NAT) can hit the cap during simultaneous onboarding,
      // but for a single-tenant personal nama abuse-prevention outweighs that cost; revisit for multi-tenant.
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
} satisfies BetterAuthOptions;

export const auth = betterAuth({
  ...options,
  plugins: [
    ...options.plugins,
    // Pass `options` as the second argument so customSession infers the
    // additionalFields (hasOnboarded) onto session.user.
    customSession(async ({ user, session }) => {
      const permissions = await loadUserPermissions(user.id);
      return { session, user, permissions };
    }, options),
  ],
});

export type Auth = typeof auth;
