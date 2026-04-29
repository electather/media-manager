import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { RoleSummary } from "@ent-mcp/shared/users";
import { deleteAccountSchema } from "@ent-mcp/shared/users";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { getDb } from "../../db/client";
import { fetchUserRole } from "./me/queries";
import { listAuthorizedApps, revokeAuthorizedApp } from "./me/apps";
import { buildUserExport } from "./me/export";
import { deleteAccount } from "./me/delete";

export const meApp = new Hono()
  .use("*", requireSession)
  .get("/role", async (c) => {
    const userId = sessionUserId(c);
    const row = await fetchUserRole(getDb(), userId);
    const role: RoleSummary | null = row ? { name: row.name, description: row.description } : null;
    return c.json({ role });
  })
  .get("/apps", async (c) => {
    const apps = await listAuthorizedApps(getDb(), sessionUserId(c));
    return c.json(apps);
  })
  .post("/apps/:clientId/revoke", async (c) => {
    const { apps } = await revokeAuthorizedApp(getDb(), sessionUserId(c), c.req.param("clientId"));
    return c.json({ ok: true, apps } as const);
  })
  .get("/export", async (c) => {
    const { zipBytes, filename } = await buildUserExport(getDb(), sessionUserId(c));
    return new Response(zipBytes, {
      status: 200,
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
      },
    });
  })
  .post("/delete", zValidator("json", deleteAccountSchema), async (c) => {
    await deleteAccount(getDb(), {
      userId: sessionUserId(c),
      confirmEmail: c.req.valid("json").confirmEmail,
      currentPassword: c.req.valid("json").currentPassword,
      headers: c.req.raw.headers,
    });
    return c.json({ ok: true } as const);
  });
