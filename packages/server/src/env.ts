import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  onValidationError: (issues) => {
    console.error("❌ Invalid environment variables:", issues);
    process.exit(1);
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
  },
  runtimeEnv: process.env,
});

if (env.CACHE_PROVIDER === "redis" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required when CACHE_PROVIDER=redis");
}
