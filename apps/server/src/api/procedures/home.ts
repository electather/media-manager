import { Hono } from "hono";
import { homeGetLayoutInputSchema, homeGetRowContentInputSchema } from "@ent-mcp/shared/home";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { zValidator } from "../../errors/validator";
import { getHomeFeedService } from "../../home";

/**
 * `home.*` oRPC procedures. Authenticated-user-only — no admin variants —
 * because the response is scoped entirely to `ctx.user.id` (V10 prevents
 * the row fetchers from reaching anything below `MediaService`, so the user
 * id from the session is the only authority that matters here).
 */
export const homeApp = new Hono()
  .use("*", requireSession)
  /**
   * `home.getLayout`. POST so we can take a strict empty body schema and
   * future-proof for variant inputs (A/B selectors live one layer up so
   * adding them never touches the fetch code).
   */
  .post("/getLayout", zValidator("json", homeGetLayoutInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const result = await getHomeFeedService().getLayout(userId);
    return c.json(result);
  })
  /**
   * `home.getRowContent`. Fired when the user scrolls a row past its inline
   * first page. The opaque cursor is validated server-side by `decodeCursor`
   * — Zod handles the shape of the wrapping body, the cursor itself is
   * checked by the row fetcher.
   */
  .post("/getRowContent", zValidator("json", homeGetRowContentInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const result = await getHomeFeedService().getRowContent(userId, c.req.valid("json"));
    return c.json(result);
  });
