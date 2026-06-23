import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  // Throw immediately at module load so the real validation failure surfaces. Silent return would yield undefined, causing cryptic "Cannot read properties of undefined" on first access.
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
    // Public-facing URL (scheme + host + port/path). Plugins use it to build OAuth redirects and deep links. Trailing slash is stripped so plugins can safely append paths.
    // Requires http(s); startup fails fast if missing or malformed.
    APP_EXTERNAL_URL: z
      .url()
      .refine((url) => url.startsWith("http://") || url.startsWith("https://"), {
        message: "APP_EXTERNAL_URL must use http or https",
      })
      .transform((url) => url.replace(/\/+$/, "")),
    // Enables transactional email (Better Auth send* hooks); false → degraded settings UI paths. Exposed unauthenticated via GET /api/config/public to gate email-dependent UI pre-signin.
    EMAIL_PROVIDER_CONFIGURED: z.stringbool().default(false),
    NOTIFICATIONS_ENABLED: z.stringbool().default(true),
    // Set true only behind a trusted reverse proxy that overwrites X-Forwarded-For. When false, rate limiter keys on socket peer address to prevent forgery.
    TRUST_PROXY: z.stringbool().default(false),
    // Max consola verbosity on job stdout (dashboard always keeps all). Levels: fatal/error (0) < warn (1) < log (2) < info/success/ready/start/box (3) < debug (4) < trace (5).
    // Defaults warn to suppress banners; set info/debug to restore.
    JOB_CONSOLE_LOG_LEVEL: z
      .enum(["silent", "fatal", "error", "warn", "log", "info", "debug", "trace", "verbose"])
      .default("warn"),
  },
  runtimeEnv: process.env,
});

if (env.CACHE_PROVIDER === "redis" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required when CACHE_PROVIDER=redis");
}
