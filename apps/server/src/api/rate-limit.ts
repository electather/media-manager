import type { Context, MiddlewareHandler } from "hono";
import type { TokenBucketLimiter } from "../mcp/rate-limit";
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
