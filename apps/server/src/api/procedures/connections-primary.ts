import { Hono } from "hono";
import { primaryConnectionSetSchema, primaryConnectionClearSchema } from "@nama/shared/connections";
import { sessionUserId } from "../../auth";
import { primaryConnectionsService } from "../../connections/primary-service";
import { zValidator } from "../../diagnostics/validator";

/**
 * Sub-app mounted under `connectionsApp` at `/primary`. The parent's
 * `requireSession` + `requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)`
 * middleware applies automatically — there are no anonymous or
 * unauthorized callers of these endpoints.
 *
 * Endpoints take a generic `(capabilityKey, mediaType)` so a future
 * `primary_with_enrichment` capability slots in without server changes.
 * Today the only consumer is `metadata@v1`.
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
