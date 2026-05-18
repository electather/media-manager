import { Hono } from "hono";
import { artworkGetInputSchema } from "@ent-mcp/shared/artwork";
import { requireSession, sessionUserId } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { ArtworkService } from "../../artwork";
import { getCatalogService } from "../../catalog";
import { TokenBucketLimiter } from "../../mcp/rate-limit";

// 30 requests/minute per user (burst=30, refill=0.5/s). Without a per-user
// limit, one user can drain the shared TMDB quota, starving other users.
const artworkLimiter = new TokenBucketLimiter({ capacity: 30, refillPerSec: 0.5 });

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
    if (artworkLimiter.check(userId) !== null) {
      return c.json({ code: "rate_limited", message: "too many artwork requests" }, 429);
    }
    const { items, languages } = c.req.valid("json");
    const service = new ArtworkService(userId, getCatalogService());
    const result = await service.getArtwork(items, languages);
    return c.json(result);
  });
