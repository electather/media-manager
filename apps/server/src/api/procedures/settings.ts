import { Hono } from "hono";
import { z } from "zod";
import { requireSession } from "../../auth";
import { zValidator } from "../../diagnostics/validator";

const updateSettingsSchema = z.object({
  // TODO: expand with actual settings fields.
  data: z.record(z.string(), z.unknown()),
});

export const settingsApp = new Hono()
  .use("*", requireSession)
  .get("/", async (c) => {
    // TODO: return user settings from DB.
    return c.json({ dbProvider: "sqlite", cacheProvider: "memory", integrations: [] });
  })
  .put("/", zValidator("json", updateSettingsSchema), async (c) => {
    // TODO: persist updated settings to DB with c.req.valid('json').
    return c.json({ success: false, message: "Not implemented" });
  });
