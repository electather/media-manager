import { Hono } from "hono";
import {
  discoverFilterQuerySchema as discoverSchema,
  discoverSearchQuerySchema as searchSchema,
  discoverTrendingQuerySchema as trendingSchema,
} from "@ent-mcp/shared/media";
import { zValidator } from "../../errors/validator";

export const discoverApp = new Hono()
  .get("/search", zValidator("query", searchSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.search(c.req.valid('query')).
    return c.json({ results: [] });
  })
  .get("/trending", zValidator("query", trendingSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.trending(c.req.valid('query')).
    return c.json({ results: [] });
  })
  .get("/", zValidator("query", discoverSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.discover(c.req.valid('query')).
    return c.json({ results: [] });
  });
