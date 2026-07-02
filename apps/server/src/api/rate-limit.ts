import type { Context, MiddlewareHandler } from "hono";
import { TokenBucketLimiter } from "../mcp/rate-limit";
import { rateLimited } from "../mcp/errors";
import { sessionUserId } from "../auth";
import { env } from "../env";
import { currentRequestContext } from "../diagnostics/request-context";

/** Checks `limiter` for `userId`. Returns a 429 Response on throttle, null on pass. */
export function rateLimitOrNull(
  limiter: TokenBucketLimiter,
  c: Context,
  userId: string,
  count = 1,
) {
  const limited = limiter.check(userId, count);
  if (limited === null) return null;
  const requestId = currentRequestContext()?.requestId;
  const err = rateLimited(limited.retryAfterSec);
  return c.json(err.toUserFacing(requestId), 429, {
    "Retry-After": String(limited.retryAfterSec),
  });
}

/** Config for {@link makeRateLimitMiddleware}. */
export interface RateLimitMiddlewareConfig {
  /** The token bucket the middleware debits. Capacity and refill live on the bucket. */
  limiter: TokenBucketLimiter;
  /**
   * Resolves the per-request bucket key. Defaults to the session user id, which
   * matches every relocated per-handler call. Override only for non-session keys.
   */
  key?: (c: Context) => string;
  /** Tokens charged per request. Defaults to 1. */
  cost?: number;
}

/** Builds a Hono middleware that debits `limiter` once per request and short-circuits with 429 + `Retry-After` header. Mount after `requireSession` and before guarded handlers. */
export function makeRateLimitMiddleware(config: RateLimitMiddlewareConfig): MiddlewareHandler {
  const { limiter, key = sessionUserId, cost = 1 } = config;
  return async (c, next) => {
    const limited = rateLimitOrNull(limiter, c, key(c), cost);
    if (limited) return limited;
    await next();
  };
}

/** Bucket key when client IP unavailable — pools callers so each shares limits. */
const UNKNOWN_CLIENT_IP = "unknown";

/** Reads socket peer address defensively instead of importing `hono/bun` — its barrel references global `Bun` which breaks under Vitest/node. */
function peerAddress(c: Context): string | undefined {
  // Named honoEnv to avoid shadowing the module-level `env` (app config) import.
  const honoEnv = c.env as { server?: unknown } | undefined;
  const server = (honoEnv && "server" in honoEnv ? honoEnv.server : honoEnv) as
    | { requestIP?: (raw: Request) => { address?: string } | null }
    | undefined;
  if (typeof server?.requestIP !== "function") return undefined;
  return server.requestIP(c.req.raw)?.address;
}

/** Resolves client IP for public limiter. Trusts X-Forwarded-For only when `trustProxy` is set; otherwise uses socket peer address (unforgeable). On direct exposure, forging X-Forwarded-For would let one client skip limits, so we reject it. Falls back to UNKNOWN_CLIENT_IP when both unavailable. */
export function resolveClientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for");
    if (forwarded) {
      const first = forwarded.split(",")[0]?.trim();
      if (first) return first;
    }
  }
  return peerAddress(c) ?? UNKNOWN_CLIENT_IP;
}

/** {@link resolveClientIp} bound to the deployment's `TRUST_PROXY` setting. */
export function clientIp(c: Context): string {
  return resolveClientIp(c, env.TRUST_PROXY);
}

/** Per-IP bucket for public, session-less endpoints. Capacity 60, refill 1/sec: ~60 req/min. Shared pool across `/config/public`, `/bootstrap`, `/public` (all low-value reads). TokenBucketLimiter evicts idle buckets via `idleEvictionMs` to bound map size. */
export const publicIpLimiter = new TokenBucketLimiter({ capacity: 60, refillPerSec: 1 });

/** Debits `publicIpLimiter` once per request keyed by `clientIp`. Must NOT use default `sessionUserId` key on session-less routes. */
export const publicIpRateLimit: MiddlewareHandler = makeRateLimitMiddleware({
  limiter: publicIpLimiter,
  key: clientIp,
});

/** Per-IP bucket for `POST /invites/:code/accept`. Capacity 5, refill 0.1/s: bounds scrypt CPU cost (hashes password per call). Separate from `publicIpLimiter` to prevent preview bursts draining accept budget. */
export const acceptIpLimiter = new TokenBucketLimiter({ capacity: 5, refillPerSec: 0.1 });

/**
 * Middleware that debits {@link acceptIpLimiter} once per request keyed by
 * {@link clientIp}. Mount it directly on the accept route handler in
 * `invites.ts` after the global middleware.
 */
export const acceptIpRateLimit: MiddlewareHandler = makeRateLimitMiddleware({
  limiter: acceptIpLimiter,
  key: clientIp,
});
