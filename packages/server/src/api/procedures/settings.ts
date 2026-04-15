import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";

const updateSettingsSchema = z.object({
  // TODO: expand with actual settings fields.
  data: z.record(z.unknown()),
});

export const settingsApp = new Hono()
  .get("/", async (c) => {
    // TODO: return user settings from DB.
    return c.json({ dbProvider: "sqlite", cacheProvider: "memory", integrations: [] });
  })
  .put("/", zValidator("json", updateSettingsSchema), async (c) => {
    // TODO: persist updated settings to DB with c.req.valid('json').
    return c.json({ success: false, message: "Not implemented" });
  });
