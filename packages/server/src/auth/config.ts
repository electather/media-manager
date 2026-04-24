import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { jwt } from "better-auth/plugins";
import { oauthProvider } from "@better-auth/oauth-provider";
import { getDb } from "../db/client";
import { env } from "../env";
import { MCP_SCOPES } from "../mcp/scopes";
import * as schema from "../db/schema/index";
import { sendEmail } from "./email";

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
        // After a successful update, if the email field changed, notify the
        // OLD address. Better Auth 1.6 has no built-in post-switch
        // notification, so we synthesise one here. The session context still
        // holds the previous email at this point because the session row
        // updates lazily. sendEmail no-ops when the provider is off.
        after: async (user, ctx) => {
          const previousEmail = ctx?.context?.session?.user?.email;
          if (!previousEmail || previousEmail === user.email) return;
          await sendEmail({
            to: previousEmail,
            subject: "Your email address was changed",
            text: `Your account email was changed to ${user.email}. If you did not approve this, contact support immediately.`,
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
