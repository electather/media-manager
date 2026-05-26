import type { Context } from "hono";
import type { TokenBucketLimiter } from "../mcp/rate-limit";

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
  return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
}
