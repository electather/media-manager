import { Hono } from "hono";
import { primaryConnectionSetSchema, primaryConnectionClearSchema } from "@nama/shared/connections";
import { sessionUserId } from "../../auth";
import { primaryConnectionsService } from "../../connections/primary-service";
import { zValidator } from "../../diagnostics/validator";

/**
 * Sub-app at `/primary` with inherited `requireSession` +
 * `requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)` middleware (no anon/unauth
 * callers). Endpoints generic `(capabilityKey, mediaType)` to slot future
 * `primary_with_enrichment` without server changes; today only `metadata@v1`.
 */
export const connectionsPrimaryApp = new Hono()
  .get("/", async (c) => {
    const primaries = await primaryConnectionsService.listForUser(sessionUserId(c));
    return c.json({ primaries });
  })
  .post("/", zValidator("json", primaryConnectionSetSchema), async (c) => {
    const body = c.req.valid("json");
    await primaryConnectionsService.set({
      userId: sessionUserId(c),
      capabilityKey: body.capabilityKey,
      mediaType: body.mediaType,
      connectionId: body.connectionId,
    });
    return c.json({ ok: true });
  })
  .delete("/", zValidator("json", primaryConnectionClearSchema), async (c) => {
    const body = c.req.valid("json");
    await primaryConnectionsService.clear({
      userId: sessionUserId(c),
      capabilityKey: body.capabilityKey,
      mediaType: body.mediaType,
    });
    return c.json({ ok: true });
  });
