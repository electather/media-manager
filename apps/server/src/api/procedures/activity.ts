import { Hono } from "hono";
import {
  activityHistoryQuerySchema as historySchema,
  activityWatchlistQuerySchema as watchlistSchema,
} from "@nama/shared/media";
import { requireSession } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { requireSession } from "../../auth";

export const activityApp = new Hono()
  .use("*", requireSession)
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
