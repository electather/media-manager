import { Hono } from "hono";
import type { CompactMediaItem } from "@ent-mcp/shared/home";
import {
  discoverFilterQuerySchema as discoverSchema,
  discoverSearchQuerySchema as searchSchema,
  discoverTrendingQuerySchema as trendingSchema,
} from "@ent-mcp/shared/media";

import { requireSession, sessionUserId } from "../../auth/middleware";
import { MediaService } from "../../media/service";
import { compactFromRaw, type PluginMediaRaw } from "../../media/compact";
import { zValidator } from "../../errors/validator";

export const discoverApp = new Hono()
  .use("*", requireSession)
  .get("/search", zValidator("query", searchSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.search(c.req.valid('query')).
    return c.json({ results: [] });
  })
  .get("/trending", zValidator("query", trendingSchema), async (c) => {
    const { mediaType, limit } = c.req.valid("query");
    const userId = sessionUserId(c);
    const mediaService = new MediaService(userId);
    // Ask for `limit + 1` so `hasMore` falls out of the same dispatch — see
    // the search handler for the same pattern.
    const raws = (await mediaService.trending(mediaType, limit + 1)) as PluginMediaRaw[];
    const mapped = raws
      .map((raw) => compactFromRaw(raw))
      .filter((item): item is CompactMediaItem => item !== null);
    const hasMore = mapped.length > limit;
    const results = hasMore ? mapped.slice(0, limit) : mapped;
    return c.json({ results, hasMore });
  })
  .get("/", zValidator("query", discoverSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.discover(c.req.valid('query')).
    return c.json({ results: [] });
  });
