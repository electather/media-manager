import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  // Throw so the real validation failure surfaces at module-load time. A
  // silent return would cause `createEnv` to yield `undefined`, which then
  // blows up with a confusing `Cannot read properties of undefined (reading
  // 'CACHE_PROVIDER')` on the first downstream access.
  onValidationError: (issues) => {
    console.error("❌ Invalid environment variables:", issues);
    throw new Error(`Invalid environment variables: ${JSON.stringify(issues)}`);
  },
  server: {
    SQLITE_PATH: z.string().optional(),
    CACHE_PROVIDER: z.enum(["memory", "redis"]).default("memory"),
    REDIS_URL: z.url().optional(),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default("0.0.0.0"),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_TRUSTED_ORIGINS: z.string().optional(),
    ENCRYPTION_KEY: z.string().min(1),
    /**
     * Public-facing URL the deployment is reachable at (including scheme and
     * any port or path prefix). Used by plugins to build OAuth redirect URIs
     * and deep links such as `playerLink` / `webLink`. Required — startup
     * fails fast if missing, malformed, or not `http(s)`. Any trailing slash
     * is stripped at parse time so plugins can safely append paths.
     */
    APP_EXTERNAL_URL: z
      .url()
      .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
        message: "APP_EXTERNAL_URL must use http or https",
      })
      .transform((url) => url.replace(/\/+$/, "")),
    /**
     * Whether the deployment has a transactional-email provider wired up.
     * When `true`, Better Auth's `sendVerificationEmail` /
     * `sendChangeEmailConfirmation` / `sendResetPassword` hooks deliver real
     * mail; when `false`, those hooks are no-ops and the settings UI falls
     * back to its degraded paths. The same flag is exposed unauthenticated
     * via `GET /api/config/public` so the client can gate email-dependent
     * UI before sign-in.
     */
    EMAIL_PROVIDER_CONFIGURED: z.stringbool().default(false),
    NOTIFICATIONS_ENABLED: z.stringbool().default(true),
    /**
     * Maximum consola verbosity printed to stdout inside job runs. Anything
     * more verbose than this threshold is dropped on stdout — buffered
     * dashboard logs keep every entry regardless. Consola levels:
     * `fatal`/`error` (0) < `warn` (1) < `log` (2) < `info`/`success`/`ready`/`start`/`box` (3) < `debug` (4) < `trace` (5).
     * Defaults to `warn` so per-run completion banners don't clutter
     * production logs; set to `info` or `debug` to bring them back.
     */
    JOB_CONSOLE_LOG_LEVEL: z
      .enum(["silent", "fatal", "error", "warn", "log", "info", "debug", "trace", "verbose"])
      .default("warn"),
  },
  runtimeEnv: process.env,
});

if (env.CACHE_PROVIDER === "redis" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required when CACHE_PROVIDER=redis");
}
