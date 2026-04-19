import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "../../errors/validator";

const searchSchema = z.object({
  query: z.string().min(1),
  mediaType: z.enum(["movie", "tv"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const trendingSchema = z.object({
  mediaType: z.enum(["movie", "tv"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const discoverSchema = z.object({
  genres: z.string().optional(),
  yearMin: z.coerce.number().int().optional(),
  yearMax: z.coerce.number().int().optional(),
  ratingMin: z.coerce.number().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

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
