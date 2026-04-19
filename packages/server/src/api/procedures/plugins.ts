import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { getDb } from "../../db/client";
import { plugins } from "../../db/schema";
import { requireSession, requirePermission } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { pluginRuntime } from "../../plugin-runtime/runtime";
import { getBuiltin } from "../../plugin-runtime/loader";

const setEnabledSchema = z.object({ enabled: z.boolean() });
const setGlobalConfigSchema = z.object({ config: z.unknown() });

export const pluginsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_PLUGINS))
  .get("/", async (c) => {
    const db = getDb();
    const rows = await db.select().from(plugins).all();
    return c.json({
      plugins: rows.map((r) => ({
        id: r.id,
        version: r.version,
        sourceType: r.sourceType,
        enabled: r.enabled === 1,
        hasGlobalConfig: !!(r.globalConfig && r.globalConfigIv),
        manifest: JSON.parse(r.manifest),
        installedAt: r.installedAt,
        updatedAt: r.updatedAt,
        isBuiltin: !!getBuiltin(r.id),
      })),
    });
  })
  .patch("/:id/enabled", zValidator("json", setEnabledSchema), async (c) => {
    const id = c.req.param("id");
    const { enabled } = c.req.valid("json");
    await pluginRuntime.setEnabled(id, enabled);
    return c.json({ ok: true });
  })
  .get("/:id/global-config", async (c) => {
    const id = c.req.param("id");
    const config = await pluginRuntime.getGlobalConfig(id);
    return c.json({ config });
  })
  .put("/:id/global-config", zValidator("json", setGlobalConfigSchema), async (c) => {
    const id = c.req.param("id");
    const { config } = c.req.valid("json");
    await pluginRuntime.setGlobalConfig(id, config);
    return c.json({ ok: true });
  })
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    if (getBuiltin(id)) {
      return c.json({ error: "built-in plugins cannot be uninstalled" }, 400);
    }
    await pluginRuntime.uninstall(id);
    return c.json({ ok: true });
  });
