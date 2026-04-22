import { Hono } from "hono";
import { createMediaRequestSchema as createRequestSchema } from "@ent-mcp/shared/media";
import { zValidator } from "../../errors/validator";

export const requestsApp = new Hono()
  .get("/", async (c) => {
    // TODO: inject MediaService and call mediaService.getRequests().
    return c.json({ items: [] });
  })
  .post("/", zValidator("json", createRequestSchema), async (c) => {
    // TODO: inject MediaService and call mediaService.requestDownload(c.req.valid('json')).
    return c.json({ success: false, message: "Not implemented" });
  });
