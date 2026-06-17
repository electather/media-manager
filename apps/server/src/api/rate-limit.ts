import type { Context, MiddlewareHandler } from "hono";
import { TokenBucketLimiter } from "../mcp/rate-limit";
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
  // Named honoEnv to avoid shadowing the module-level `env` (app config) import.
  const honoEnv = c.env as { server?: unknown } | undefined;
  const server = (honoEnv && "server" in honoEnv ? honoEnv.server : honoEnv) as
    | { requestIP?: (raw: Request) => { address?: string } | null }
    | undefined;
  if (typeof server?.requestIP !== "function") return undefined;
  return server.requestIP(c.req.raw)?.address;
}

/**
 * Resolves the client IP for keying the public (session-less) limiter.
 *
 * `X-Forwarded-For` is only honoured when `trustProxy` is set — i.e. Nama is
 * known to sit behind a reverse proxy / CDN that overwrites the header. On a
 * directly-exposed server the header is attacker-controlled: trusting it would
 * let a single client forge a fresh key per request to skip the limit (and pile
 * arbitrary entries into the bucket map), so we key on the un-forgeable socket
 * peer address instead, falling back to a constant when even that is
 * unavailable (so an unresolvable caller is still bucketed, not skipped).
 */
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

/**
 * Per-IP bucket guarding the public, session-less endpoints (`/config/public`,
 * `/bootstrap`, `/public`). Capacity 60 with refill 1/sec is generous — these are
 * cached, side-effect-free reads (plus the rare one-time bootstrap claim) — so a
 * normal login-page visitor never trips it while a single IP hammering the path
 * is still capped at ~60 req/min. Sized like the artwork/MCP limiters; tune up if
 * legitimate login traffic ever proves burstier than 60 in a 60s window.
 *
 * One shared bucket pool guards all three public route groups on purpose (they
 * are all low-value decorative reads, so an IP's budget is shared across them).
 * Keyed by public client IPs the map would otherwise accumulate an entry per IP
 * ever seen; TokenBucketLimiter caps that by evicting buckets that have
 * refilled to full and gone idle (see its `idleEvictionMs`), so the map stays
 * bounded by recently-active IPs.
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

/**
 * Per-IP bucket guarding `POST /invites/:code/accept`. Capacity 5 with refill
 * 0.1/s bounds scrypt CPU exposure — each accept call hashes a password — while
 * still covering every legitimate single-IP use (an invitee submits once).
 * Separate from {@link publicIpLimiter} so a preview burst does not drain the
 * accept budget.
 */
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
