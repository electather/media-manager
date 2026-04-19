import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { requireSession, requirePermission } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { connectionsService } from "../../connections/service";

interface SessionCtx {
  user: { id: string };
}

function userId(c: { get: (key: "session") => SessionCtx | undefined }): string {
  const session = c.get("session");
  if (!session) throw new Error("no session");
  return session.user.id;
}

const createSchema = z.object({
  pluginId: z.string(),
  userConfig: z.unknown(),
  displayName: z.string().optional(),
});

const displayNameSchema = z.object({ displayName: z.string().min(1) });
const userConfigSchema = z.object({ userConfig: z.unknown() });
const enabledSchema = z.object({ enabled: z.boolean() });
const deviceStartSchema = z.object({ pluginId: z.string() });
const devicePollSchema = z.object({ nonce: z.string() });
const redirectStartSchema = z.object({ pluginId: z.string() });
const redirectCompleteSchema = z.object({
  nonce: z.string(),
  queryParams: z.record(z.string(), z.string()),
});

export const connectionsApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS))
  .get("/", async (c) => {
    const list = await connectionsService.listForUser(userId(c));
    return c.json({ connections: list });
  })
  .get("/available", async (c) => {
    const list = await connectionsService.listAvailablePlugins();
    return c.json({ plugins: list });
  })
  .get("/:id/user-config", async (c) => {
    const config = await connectionsService.getUserConfig(userId(c), c.req.param("id"));
    return c.json({ config });
  })
  .post("/", zValidator("json", createSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await connectionsService.createFormConnection({
      userId: userId(c),
      pluginId: body.pluginId,
      userConfig: body.userConfig,
      displayName: body.displayName,
    });
    return c.json(result);
  })
  .patch("/:id/display-name", zValidator("json", displayNameSchema), async (c) => {
    await connectionsService.updateDisplayName({
      userId: userId(c),
      connectionId: c.req.param("id"),
      displayName: c.req.valid("json").displayName,
    });
    return c.json({ ok: true });
  })
  .patch("/:id/user-config", zValidator("json", userConfigSchema), async (c) => {
    await connectionsService.updateUserConfig({
      userId: userId(c),
      connectionId: c.req.param("id"),
      userConfig: c.req.valid("json").userConfig,
    });
    return c.json({ ok: true });
  })
  .patch("/:id/enabled", zValidator("json", enabledSchema), async (c) => {
    await connectionsService.setEnabled({
      userId: userId(c),
      connectionId: c.req.param("id"),
      enabled: c.req.valid("json").enabled,
    });
    return c.json({ ok: true });
  })
  .post("/:id/default", async (c) => {
    await connectionsService.setDefault({
      userId: userId(c),
      connectionId: c.req.param("id"),
    });
    return c.json({ ok: true });
  })
  .post("/:id/test", async (c) => {
    const result = await connectionsService.test({
      userId: userId(c),
      connectionId: c.req.param("id"),
    });
    return c.json(result);
  })
  .delete("/:id", async (c) => {
    await connectionsService.delete({
      userId: userId(c),
      connectionId: c.req.param("id"),
    });
    return c.json({ ok: true });
  })
  .post("/oauth/redirect/start", zValidator("json", redirectStartSchema), async (c) => {
    const result = await connectionsService.initiateRedirectAuth({
      userId: userId(c),
      pluginId: c.req.valid("json").pluginId,
    });
    return c.json(result);
  })
  .post("/oauth/redirect/complete", zValidator("json", redirectCompleteSchema), async (c) => {
    const body = c.req.valid("json");
    const result = await connectionsService.completeRedirectAuth({
      userId: userId(c),
      nonce: body.nonce,
      queryParams: body.queryParams,
    });
    return c.json(result);
  })
  .post("/oauth/device/start", zValidator("json", deviceStartSchema), async (c) => {
    const result = await connectionsService.initiateDeviceAuth({
      userId: userId(c),
      pluginId: c.req.valid("json").pluginId,
    });
    return c.json(result);
  })
  .post("/oauth/device/poll", zValidator("json", devicePollSchema), async (c) => {
    const result = await connectionsService.pollDeviceAuth({
      userId: userId(c),
      nonce: c.req.valid("json").nonce,
    });
    return c.json(result);
  });
