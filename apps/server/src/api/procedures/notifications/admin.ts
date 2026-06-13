// fallow-ignore-file complexity
import { Hono } from "hono";
import { last } from "es-toolkit/array";
import { consola } from "consola";
import { adminDeliveriesQuerySchema, adminSettingsBodySchema } from "@nama/shared/notifications";
import { requirePermission, requireSession, PERMISSIONS } from "../../../auth";
import { conflict, notFound } from "../../../diagnostics/http-errors";
import { zValidator } from "../../../diagnostics/validator";
import { getNotificationsService } from "../../../notifications";
import { decodeKeysetCursor, encodeKeysetCursor, flagGate } from "./helpers";

export const adminNotificationsApp = new Hono()
  .use("*", flagGate())
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_SERVER))
  .get("/deliveries", zValidator("query", adminDeliveriesQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const cursor = decodeKeysetCursor(q.cursor);
    const rows = await getNotificationsService().listDeliveries(
      {
        ...(q.status ? { status: q.status } : {}),
        ...(q.category ? { category: q.category } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.recipientUserId ? { recipientUserId: q.recipientUserId } : {}),
        ...(q.from !== undefined ? { from: q.from } : {}),
        ...(q.to !== undefined ? { to: q.to } : {}),
      },
      cursor,
      q.limit,
    );
    const lastRow = last(rows);
    const nextCursor =
      rows.length === q.limit && lastRow
        ? encodeKeysetCursor(lastRow.createdAt, lastRow.id)
        : undefined;
    return c.json({
      deliveries: rows,
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    });
  })
  .get("/deliveries/:id", async (c) => {
    const id = c.req.param("id");
    const detail = await getNotificationsService().getDeliveryDetail(id);
    if (!detail) throw notFound("notifications.delivery_not_found", "delivery not found");
    // The design doc reserves an `attempts: AttemptRecord[]` field for a
    // future per-attempt history table. None exists in v1, so the field is
    // omitted rather than returned as a permanently empty array.
    return c.json({
      delivery: { ...detail.delivery, eventPayload: detail.eventPayload },
    });
  })
  .post("/deliveries/:id/retry", async (c) => {
    const id = c.req.param("id") as string;
    const service = getNotificationsService();

    const reset = await service.resetDeliveryForRetry(id);
    if (reset === "not_found") {
      throw notFound("notifications.delivery_not_found", "delivery not found");
    }
    if (reset === "in_progress") {
      // Refuse to reset a row mid-flight — the in-flight job could complete
      // and a re-enqueued job CAS-acquire the now-pending row, double-firing.
      throw conflict(
        "notifications.delivery_in_progress",
        "delivery is currently in flight; retry once it has settled",
      );
    }

    const rescheduled = await service.triggerDeliveryRetry(id);
    if (!rescheduled) {
      // The row was reset to pending but no job was enqueued. The
      // stale-pending sweep (every 5 min) is the only recovery path —
      // surface this so ops can detect a misregistered job runner instead
      // of silently relying on the sweep.
      consola.warn(
        `notifications: retry for delivery ${id} reset row to pending but the notification.deliver job is not registered; stale-pending sweep is the only recovery path`,
      );
    }
    return c.json({ ok: true, rescheduled });
  })
  .get("/settings", async (c) => {
    const settings = await getNotificationsService().getSettings();
    return c.json(settings);
  })
  .patch("/settings", zValidator("json", adminSettingsBodySchema), async (c) => {
    const next = await getNotificationsService().updateSettings(c.req.valid("json"));
    return c.json({ ok: true, ...next });
  });
