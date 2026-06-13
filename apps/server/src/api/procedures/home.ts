import { Hono } from "hono";
import { homeGetLayoutInputSchema } from "@nama/shared/home";
import { requireSession, sessionUserId } from "../../auth";
import { zValidator } from "../../diagnostics/validator";
import { buildContext, composeLayout } from "../../home";

/**
 * The home procedure is layout-only after the §A8 cutover. Row content, title
 * details, and season availability now serve from the unified media surface
 * (`api.media.*`); only the home layout stub list remains home-owned.
 */
export const homeApp = new Hono()
  .use("*", requireSession)
  .get("/layout", zValidator("query", homeGetLayoutInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const ctx = buildContext(userId);
    const layout = await composeLayout(ctx);
    return c.json(layout);
  });
