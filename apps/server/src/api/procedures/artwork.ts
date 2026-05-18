import { Hono } from "hono";
import { artworkGetInputSchema, type ArtworkRequestItem } from "@ent-mcp/shared/artwork";
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

/**
 * `artwork.*` RPC procedures. Authenticated-user-only — no anon access since
 * dispatch consumes admin-pool credentials (TMDB key today, fanart key when
 * that plugin lands). Per-item failures ride back on the response's `errors`
 * map so a single bad input never breaks the batch.
 */
export const artworkApp = new Hono()
  .use("*", requireSession)
  .post("/get", zValidator("json", artworkGetInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const { items, languages } = c.req.valid("json");
    // Charge the bucket by the number of unique canonical lookups so batched
    // requests cost what they actually cost downstream.
    const uniqueLookups = countCanonical(items);
    const limited = artworkLimiter.check(userId, uniqueLookups);
    if (limited !== null) {
      const retryAfter = (limited.details as { retry_after: number } | undefined)?.retry_after ?? 1;
      return c.json(limited.toUserFacing(), 429, { "Retry-After": String(retryAfter) });
    }
    const service = new ArtworkService(userId, getCatalogService());
    const result = await service.getArtwork(items, languages);
    return c.json(result);
  });

function countCanonical(items: readonly ArtworkRequestItem[]): number {
  const seen = new Set<string>();
  for (const item of items) {
    const parts: string[] = [item.type];
    for (const k of ["tmdb", "imdb", "tvdb"] as const) {
      const value = item.ids[k];
      if (value) parts.push(`${k}:${value}`);
    }
    seen.add(parts.join("|"));
  }
  return Math.max(1, seen.size);
}
