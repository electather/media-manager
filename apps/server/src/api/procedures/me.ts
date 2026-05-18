import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { RoleSummary } from "@ent-mcp/shared/users";
import { deleteAccountSchema } from "@ent-mcp/shared/users";
import { requireSession, sessionUserId } from "../../auth";
import { getDb } from "../../db/client";
import { fetchUserRole } from "./me/queries";
import { listAuthorizedApps, revokeAuthorizedApp } from "./me/apps";
import { buildUserExport } from "./me/export";
import { deleteAccount } from "./me/delete";
import { TokenBucketLimiter } from "../../mcp/rate-limit";
import { currentRequestContext } from "../../diagnostics/request-context";

// 5 exports per hour per user. The export builds a multi-table ZIP in memory,
// so a low burst cap is intentional to prevent memory exhaustion from flooding.
// @internal — exported only so tests can call `.reset()`; no production caller.
export const exportLimiter = new TokenBucketLimiter({ capacity: 5, refillPerSec: 5 / 3600 });

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
    const userId = sessionUserId(c);
    const limited = exportLimiter.check(userId);
    if (limited !== null) {
      // `rateLimited()` always sets `params.retry_after`, but `params` is
      // typed optional on `McpError` — the `?? 3600` fallback exists only to
      // satisfy the type guard. Conservative default (a full refill window)
      // wins over an eager retry if the field is ever genuinely missing.
      const retryAfter = Number(limited.params?.retry_after ?? 3600);
      const requestId = currentRequestContext()?.requestId;
      return c.json(limited.toUserFacing(requestId), 429, { "Retry-After": String(retryAfter) });
    }
    const { zipBytes, filename } = await buildUserExport(getDb(), userId);
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
