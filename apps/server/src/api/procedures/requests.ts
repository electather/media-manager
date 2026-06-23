import { Hono } from "hono";
import { createMediaRequestSchema, requestTargetsQuerySchema } from "@nama/shared/media";
import { requireSession, sessionUserId } from "../../auth";
import { MediaService } from "../../media";
import { zValidator } from "../../diagnostics/validator";

/** Requests API: list, submit, cancel, and aggregate request targets for the picker. */
export const requestsApp = new Hono()
  .use("*", requireSession)
  .get("/", async (c) => {
    const svc = new MediaService(sessionUserId(c));
    const items = await svc.getRequests();
    return c.json({ items });
  })
  .get("/targets", zValidator("query", requestTargetsQuerySchema), async (c) => {
    const svc = new MediaService(sessionUserId(c));
    const targets = await svc.listRequestTargets(c.req.valid("query").mediaType);
    return c.json({ targets });
  })
  .post("/", zValidator("json", createMediaRequestSchema), async (c) => {
    const svc = new MediaService(sessionUserId(c));
    const result = await svc.requestDownload(c.req.valid("json"));
    return c.json(result);
  })
  .delete("/:requestId", async (c) => {
    const requestId = c.req.param("requestId");
    const svc = new MediaService(sessionUserId(c));
    await svc.cancelRequest(requestId);
    return c.json({ ok: true });
  });
