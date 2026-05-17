import { Hono } from "hono";
import { artworkGetInputSchema } from "@ent-mcp/shared/artwork";
import { requireSession, sessionUserId } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { ArtworkService } from "../../artwork";
import { getCatalogService } from "../../catalog";

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
    const service = new ArtworkService(userId, getCatalogService());
    const result = await service.getArtwork(items, languages);
    return c.json(result);
  });
