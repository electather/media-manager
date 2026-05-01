import { Hono } from "hono";
import { mediaGetInputSchema, mediaGetManyInputSchema } from "@ent-mcp/shared/media";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { zValidator } from "../../errors/validator";
import { notFound } from "../../errors/http-errors";
import { MediaService } from "../../media/service";

/**
 * `media.*` RPC procedures. Authenticated-user-only — `MediaService(userId)`
 * scopes plugin dispatch per user. `media.get` 404s on missing ids;
 * `media.getMany` always 200 and silently omits missing ids per V81 batch
 * contract.
 */
export const mediaApp = new Hono()
  .use("*", requireSession)
  .post("/get", zValidator("json", mediaGetInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const { id } = c.req.valid("json");
    const detail = await new MediaService(userId).getDetailsTyped(id);
    if (!detail) throw notFound("media.not_found", "media not found", { id });
    return c.json(detail);
  })
  .post("/getMany", zValidator("json", mediaGetManyInputSchema), async (c) => {
    const userId = sessionUserId(c);
    const { ids } = c.req.valid("json");
    const items = await new MediaService(userId).getDetailsBatchTyped(ids);
    return c.json({ items });
  });
