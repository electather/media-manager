import { Hono } from "hono";
import { createMediaRequestSchema, requestTargetsQuerySchema } from "@ent-mcp/shared/media";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { MediaService } from "../../media/service";
import { zValidator } from "../../errors/validator";

/**
 * `GET /api/requests` lists the caller's outstanding requests.
 * `GET /api/requests/targets` aggregates plugin-supplied request services for
 * the picker.
 * `POST /api/requests` submits a new request through the targeted connection.
 */
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
  });
