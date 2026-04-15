import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const historySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

const watchlistSchema = z.object({
  mediaType: z.enum(["movie", "tv"]).optional(),
});

export const activityApp = new Hono()
  .get("/history", zValidator("query", historySchema), async (c) => {
    // TODO: inject MediaService and call mediaService.getHistory(c.req.valid('query')).
    return c.json({ items: [] });
  })
  .get("/watchlist", zValidator("query", watchlistSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.getWatchlist(c.req.valid('query')).
    return c.json({ items: [] });
  })
  .get("/upcoming", async (c) => {
    // TODO: inject MediaService and call mediaService.getUpcoming().
    return c.json({ items: [] });
  })
  .get("/progress", async (c) => {
    // TODO: inject MediaService and call mediaService.getProgress().
    return c.json({ items: [] });
  });
