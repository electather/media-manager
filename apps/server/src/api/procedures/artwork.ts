import { Hono } from "hono";
import { artworkGetInputSchema, countCanonicalArtwork } from "@nama/shared/artwork";
import { requireSession, sessionUserId } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { ArtworkService } from "../../artwork";
import { getCatalogService } from "../../catalog";
import { TokenBucketLimiter } from "../../mcp/rate-limit";

// Approximately 60 dispatches/minute per user (burst=60, refill=1/s). Tokens
// are consumed per *unique* canonical lookup in a batch — not per request —
// because the 50-item input schema would otherwise let a single user drive
// up to 30×50 = 1,500 provider lookups/min and exhaust the shared TMDB
// quota despite the limit.
export const artworkLimiter = new TokenBucketLimiter({ capacity: 60, refillPerSec: 1 });

/** Authenticated-user-only RPC (dispatch consumes admin-pool credentials: TMDB key, fanart key).
 *  Per-item failures in response's `errors` map to avoid breaking batch on bad input.
 */
export const artworkApp = new Hono()
  .use("*", requireSession)
  .post("/get", zValidator("json", artworkGetInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const { items, languages } = c.req.valid("json");
    // Charge the bucket by the number of unique canonical lookups so batched
    // requests cost what they actually cost downstream.
    const uniqueLookups = countCanonicalArtwork(items);
    const limited = artworkLimiter.check(userId, uniqueLookups);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
    const service = new ArtworkService(userId, getCatalogService());
    const result = await service.getArtwork(items, languages);
    return c.json(result);
  });
