import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    DB_PROVIDER: z.enum(["postgres", "sqlite"]).default("sqlite"),
    DATABASE_URL: z.string().url().optional(),
    SQLITE_PATH: z.string().optional(),
    CACHE_PROVIDER: z.enum(["memory", "redis"]).default("memory"),
    REDIS_URL: z.string().url().optional(),
    PORT: z.coerce.number().default(3000),
    HOST: z.string().default("0.0.0.0"),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),
    ENCRYPTION_KEY: z.string().min(1),
    TRAKT_CLIENT_ID: z.string().optional(),
    TRAKT_CLIENT_SECRET: z.string().optional(),
    TMDB_API_KEY: z.string().optional(),
    SEERR_URL: z.string().url().optional(),
    SEERR_API_KEY: z.string().optional(),
    TVDB_API_KEY: z.string().optional(),
  },
  runtimeEnv: process.env,
});

// Cross-field validation that can't be expressed in individual schemas.
if (env.DB_PROVIDER === "postgres" && !env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when DB_PROVIDER=postgres");
}
if (env.CACHE_PROVIDER === "redis" && !env.REDIS_URL) {
  throw new Error("REDIS_URL is required when CACHE_PROVIDER=redis");
}
