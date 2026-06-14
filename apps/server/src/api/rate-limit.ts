import type { Context, MiddlewareHandler } from "hono";
import { TokenBucketLimiter } from "../mcp/rate-limit";
import { sessionUserId } from "../auth";
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
  const retryAfter = limited.params?.retry_after ?? 1;
  const requestId = currentRequestContext()?.requestId;
  return c.json(limited.toUserFacing(requestId), 429, { "Retry-After": String(retryAfter) });
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

/**
 * Builds a Hono middleware that debits `limiter` once per request and short-circuits
 * with the shared 429 body + `Retry-After` header when the bucket is empty — the
 * same response `rateLimitOrNull` produces, so behavior is identical to the inline
 * calls it replaces. Mount it after `requireSession` (the default key reads the
 * session) and before the handlers it should guard.
 */
export function makeRateLimitMiddleware(config: RateLimitMiddlewareConfig): MiddlewareHandler {
  const { limiter, key = sessionUserId, cost = 1 } = config;
  return async (c, next) => {
    const limited = rateLimitOrNull(limiter, c, key(c), cost);
    if (limited) return limited;
    await next();
  };
}

/** Bucket key used when no client IP can be resolved, so unkeyable callers share
 *  one bucket rather than each getting a fresh, effectively-unlimited one. */
const UNKNOWN_CLIENT_IP = "unknown";

/**
 * Mirrors `hono/bun`'s `getConnInfo`: the Bun server is on `c.env` (directly, or
 * under `c.env.server`) and exposes `requestIP(raw)`. We read it defensively here
 * instead of importing `hono/bun`, whose barrel eagerly references the global
 * `Bun` (via the SSG helper) and so cannot load under the Vitest/node test
 * runner. Returns the socket peer address, or undefined when unavailable.
 */
function peerAddress(c: Context): string | undefined {
  const env = c.env as { server?: unknown } | undefined;
  const server = (env && "server" in env ? env.server : env) as
    | { requestIP?: (raw: Request) => { address?: string } | null }
    | undefined;
  if (typeof server?.requestIP !== "function") return undefined;
  return server.requestIP(c.req.raw)?.address;
}

/**
 * Resolves the client IP for keying the public (session-less) limiter. Prefers
 * the first `x-forwarded-for` hop — the original client when nama sits behind the
 * documented reverse proxy / CDN — and falls back to the socket peer address for
 * direct connections, then to a constant so an unresolvable caller is still
 * bucketed rather than skipping the limit. The header is untrusted (a direct
 * client can forge it), but the public endpoints it guards are decorative,
 * side-effect-free reads, so a forged key only lets an attacker split their own
 * traffic across buckets — it never grants extra access.
 */
export function clientIp(c: Context): string {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return peerAddress(c) ?? UNKNOWN_CLIENT_IP;
}

/**
 * Per-IP bucket guarding the public, session-less endpoints (`/config/public`,
 * `/bootstrap`, `/public`). Capacity 60 with refill 1/sec is generous — these are
 * cached, side-effect-free reads (plus the rare one-time bootstrap claim) — so a
 * normal login-page visitor never trips it while a single IP hammering the path
 * is still capped at ~60 req/min. Sized like the artwork/MCP limiters; tune up if
 * legitimate login traffic ever proves burstier than 60 in a 60s window.
 */
export const publicIpLimiter = new TokenBucketLimiter({ capacity: 60, refillPerSec: 1 });

/**
 * Middleware that debits {@link publicIpLimiter} once per request keyed by
 * {@link clientIp}. Mount it on the public route groups in `router.ts` after the
 * global request-context/perf middleware — it must NOT use the default
 * `sessionUserId` key, which throws on session-less routes.
 */
export const publicIpRateLimit: MiddlewareHandler = makeRateLimitMiddleware({
  limiter: publicIpLimiter,
  key: clientIp,
});
