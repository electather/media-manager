// fallow-ignore-file complexity
import { Hono } from "hono";
import { last } from "es-toolkit/array";
import { consola } from "consola";
import { eq } from "drizzle-orm";
import {
  type NotificationEvent,
  adminDeliveriesQuerySchema,
  adminSettingsBodySchema,
} from "@ent-mcp/shared/notifications";
import { requirePermission, requireSession } from "../../../auth/middleware";
import { PERMISSIONS } from "../../../auth/permissions";
import { getDb } from "../../../db/client";
import { notificationDeliveries } from "../../../db/schema";
import { conflict, notFound } from "../../../errors/http-errors";
import { newRequestId } from "../../../errors/request-context";
import { zValidator } from "../../../errors/validator";
import { findEntry } from "../../../jobs/registry";
import {
  deliveryRowToDto,
  listDeliveries,
  resetDeliveryForRetry,
} from "../../../notifications/repos";
import { getNotificationSettings, setNotificationSettings } from "../../../notifications/settings";
import { decodeKeysetCursor, encodeKeysetCursor, flagGate } from "./helpers";

export const adminNotificationsApp = new Hono()
  .use("*", flagGate())
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_SERVER))
  .get("/deliveries", zValidator("query", adminDeliveriesQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const cursor = decodeKeysetCursor(q.cursor);
    const rows = await listDeliveries(
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
      deliveries: rows.map(deliveryRowToDto),
      ...(nextCursor !== undefined ? { nextCursor } : {}),
    });
  })
  .get("/deliveries/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const row = await db
      .select()
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, id))
      .get();
    if (!row) throw notFound("notifications.delivery_not_found", "delivery not found");
    let eventPayload: NotificationEvent | null = null;
    try {
      eventPayload = JSON.parse(row.eventPayload) as NotificationEvent;
    } catch {
      eventPayload = null;
    }
    // The design doc reserves an `attempts: AttemptRecord[]` field for a
    // future per-attempt history table. None exists in v1, so the field is
    // omitted rather than returned as a permanently empty array — the
    // client can detect the absent field and hide the section.
    return c.json({ delivery: { ...deliveryRowToDto(row), eventPayload } });
  })
  .post("/deliveries/:id/retry", async (c) => {
    const id = c.req.param("id") as string;

    const reset = await resetDeliveryForRetry(id);
    if (reset === "not_found") {
      throw notFound("notifications.delivery_not_found", "delivery not found");
    }
    if (reset === "in_progress") {
      // Refuse to reset a row mid-flight — the in-flight job could complete
      // and a re-enqueued job CAS-acquire the now-pending row, double-firing.
      // The admin should wait for the in-flight attempt to settle.
      throw conflict(
        "notifications.delivery_in_progress",
        "delivery is currently in flight; retry once it has settled",
      );
    }

    const jobEntry = findEntry("notification.deliver");
    let rescheduled = false;
    if (jobEntry?.triggerFromApi) {
      await jobEntry.triggerFromApi(
        { deliveryId: id },
        { triggeredBy: "admin", requestId: newRequestId() },
      );
      rescheduled = true;
    } else {
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
    const settings = await getNotificationSettings();
    return c.json(settings);
  })
  .patch("/settings", zValidator("json", adminSettingsBodySchema), async (c) => {
    const next = await setNotificationSettings(c.req.valid("json"));
    return c.json({ ok: true, ...next });
  });
