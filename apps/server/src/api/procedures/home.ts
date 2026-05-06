import { Hono } from "hono";
import { z } from "zod";
import {
  homeGetDetailsInputSchema,
  homeGetLayoutInputSchema,
  homeGetRowContentInputSchema,
  homeGetSeasonAvailabilityInputSchema,
} from "@ent-mcp/shared/home";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { zValidator } from "../../errors/validator";
import { buildContext, composeDetails, composeLayout, composeRow } from "../../home/orchestrator";
import { composeSeasonAvailability } from "../../home/season-availability";

/**
 * `cursor` arrives as a query string — `null` is encoded as the literal
 * `null` (or omitted entirely). Reshape to `{ cursor: string | null }` here
 * so the orchestrator stays in the typed lane.
 */
const rowContentQuerySchema = z
  .object({
    rowId: z.string().min(1),
    cursor: z.string().optional(),
  })
  .strict()
  .transform((value) => ({
    rowId: value.rowId,
    cursor: value.cursor === undefined || value.cursor === "null" ? null : value.cursor,
  }))
  .pipe(homeGetRowContentInputSchema);

export const homeApp = new Hono()
  .use("*", requireSession)
  .get("/layout", zValidator("query", homeGetLayoutInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const ctx = buildContext(userId);
    const layout = await composeLayout(ctx);
    return c.json(layout);
  })
  .get("/row", zValidator("query", rowContentQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const { rowId, cursor } = c.req.valid("query");
    const ctx = buildContext(userId);
    const page = await composeRow(ctx, rowId, cursor);
    return c.json(page);
  })
  .get("/details", zValidator("query", homeGetDetailsInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const { tmdbId, mediaType } = c.req.valid("query");
    const ctx = buildContext(userId);
    const details = await composeDetails(ctx, tmdbId, mediaType);
    return c.json(details);
  })
  .get(
    "/season-availability",
    zValidator("query", homeGetSeasonAvailabilityInputSchema),
    async (c) => {
      const userId = sessionUserId(c);
      const { tmdbId } = c.req.valid("query");
      const ctx = buildContext(userId);
      const availability = await composeSeasonAvailability(ctx, tmdbId);
      return c.json(availability);
    },
  );
