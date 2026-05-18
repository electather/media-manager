import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { env } from "../env";
import { MCP_SCOPES } from "@ent-mcp/shared/users";
import * as schema from "../db/schema/index";
import { user } from "../db/schema/auth";
import { sendEmail } from "./email";

// Tracks the email an account held immediately before an update so the after
// hook can notify the old address even without the Better Auth internal session
// context (which is not part of the public API and can change across versions).
const pendingEmailChange = new Map<string, string>();

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
  databaseHooks: {
    user: {
      update: {
        // Capture the current email before Better Auth writes the update.
        // Reading from the DB here is more reliable than reading
        // `ctx?.context?.session?.user?.email` in the after hook, which
        // accesses Better Auth's internal context shape (not a public API).
        before: async (data) => {
          const db = getDb();
          const row = await db
            .select({ email: user.email })
            .from(user)
            .where(eq(user.id, data.id))
            .get();
          if (row) {
            pendingEmailChange.set(data.id, row.email);
          }
          return data;
        },
        // After a successful update, if the email field changed, notify the
        // OLD address. Better Auth 1.6 has no built-in post-switch
        // notification, so we synthesise one here. sendEmail no-ops when
        // the provider is not configured.
        after: async (updatedUser) => {
          const previousEmail = pendingEmailChange.get(updatedUser.id);
          pendingEmailChange.delete(updatedUser.id);
          if (!previousEmail || previousEmail === updatedUser.email) return;
          await sendEmail({
            to: previousEmail,
            subject: "Your email address was changed",
            text: `Your account email was changed to ${updatedUser.email}. If you did not approve this, contact support immediately.`,
          });
        },
      },
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
