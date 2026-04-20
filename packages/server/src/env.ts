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
  },
  runtimeEnv: process.env,
});

if (env.CACHE_PROVIDER === "redis" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required when CACHE_PROVIDER=redis");
}
