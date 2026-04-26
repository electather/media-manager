import { Hono, type Context, type Next } from "hono";
import { eq, and, inArray } from "drizzle-orm";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_PERMISSION,
  type NotificationCategory,
  type NotificationContentKind,
  type NotificationEvent,
  inboxDeleteAllBodySchema,
  inboxDeleteBodySchema,
  inboxListQuerySchema,
  inboxMarkAllReadBodySchema,
  inboxMarkBodySchema,
  subscriptionUpdateBodySchema,
  subscriptionsBulkBodySchema,
  adminDeliveriesQuerySchema,
  adminSettingsBodySchema,
} from "@ent-mcp/shared/notifications";
import { requireSession, requirePermission, sessionUserId } from "../../auth/middleware";
import { PERMISSIONS, type Permission } from "../../auth/permissions";
import { connectionsService } from "../../connections/service";
import { getDb } from "../../db/client";
import { rolePermissions, userRoles, roles } from "../../db/schema/roles";
import { notificationDeliveries, serviceConnections } from "../../db/schema";
import { env } from "../../env";
import { badRequest, forbidden, notFound, payloadTooLarge } from "../../errors/http-errors";
import { newRequestId } from "../../errors/request-context";
import { zValidator } from "../../errors/validator";
import { find } from "../../jobs/registry";
import { capabilityRegistry } from "../../plugin-runtime/registry";
import {
  deleteInboxAllForUser,
  deleteInboxForUser,
  getUnreadCount,
  listDeliveries,
  listInboxForUser,
  listSubscriptionsForConnections,
  markAllReadForUser,
  markInboxReadForUser,
  markInboxUnreadForUser,
  resetDeliveryForRetry,
  upsertSubscription,
} from "../../notifications/repos";
import { getNotificationSettings, setNotificationSettings } from "../../notifications/settings";

const NOTIFICATION_CAPABILITY_ID = "notificationDelivery";
const NOTIFICATION_CAPABILITY_VERSION = "v1";

const SUBSCRIPTION_BULK_LIMIT = 200;

const CATEGORY_LABELS: Record<NotificationCategory, { label: string; description: string }> = {
  media: { label: "Media", description: "Requests, availability, denials" },
  sync: { label: "Sync", description: "Connection sync results" },
  auth: { label: "Authentication", description: "Connection auth lifecycle" },
  system: { label: "System", description: "Server-level alerts" },
};

function flagGate() {
  return async (_c: Context, next: Next): Promise<void> => {
    if (!env.NOTIFICATIONS_ENABLED) {
      throw notFound("notifications.disabled", "notifications feature is disabled");
    }
    await next();
  };
}

function notificationCapablePluginIds(): Set<string> {
  return new Set(
    capabilityRegistry.listProviders(
      NOTIFICATION_CAPABILITY_ID,
      NOTIFICATION_CAPABILITY_VERSION,
      "user",
    ),
  );
}

function manifestSupportsKinds(pluginId: string): NotificationContentKind[] {
  const entry = capabilityRegistry.get(pluginId);
  const cap = entry?.module.manifest.capabilities[NOTIFICATION_CAPABILITY_ID];
  return cap?.supportsKinds ?? ["text"];
}

async function userHasPermission(userId: string, permission: Permission): Promise<boolean> {
  const db = getDb();
  const userRole = await db
    .select({ roleId: userRoles.roleId, isSystem: roles.isSystem, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();
  if (!userRole) return false;
  if (userRole.isSystem === 1 && userRole.name === "Admin") return true;
  const allowed = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .where(
      and(eq(rolePermissions.roleId, userRole.roleId), eq(rolePermissions.permission, permission)),
    )
    .get();
  return !!allowed;
}

// Cursor format: base64url(`<created_at_iso>|<id>`). The pipe is reserved
// because the ISO-8601 timestamp itself contains `:` characters.
const INBOX_CURSOR_SEP = "|";

function decodeInboxCursor(
  cursor: string | undefined,
): { createdAt: number; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    const sep = decoded.indexOf(INBOX_CURSOR_SEP);
    if (sep <= 0) throw new Error("malformed");
    const iso = decoded.slice(0, sep);
    const id = decoded.slice(sep + 1);
    const createdAt = Date.parse(iso);
    if (Number.isNaN(createdAt) || !id) throw new Error("malformed");
    return { createdAt, id };
  } catch {
    throw badRequest("notifications.bad_cursor", "invalid cursor");
  }
}

function encodeInboxCursor(createdAt: number, id: string): string {
  const iso = new Date(createdAt).toISOString();
  return Buffer.from(`${iso}${INBOX_CURSOR_SEP}${id}`, "utf8").toString("base64url");
}

// ─── User-facing procedures ────────────────────────────────────────────────

export const notificationsApp = new Hono()
  .use("*", flagGate())
  .use("*", requireSession)
  .get("/plugins", async (c) => {
    const ids = notificationCapablePluginIds();
    const plugins = [];
    for (const id of ids) {
      const entry = capabilityRegistry.get(id);
      if (!entry) continue;
      const manifest = entry.module.manifest;
      plugins.push({
        id: manifest.id,
        name: manifest.name,
        description: manifest.description,
        authKind: manifest.auth.kind,
        supportsKinds: manifestSupportsKinds(id),
        userConfigSchema:
          (manifest.userConfigSchema as Record<string, unknown> | undefined) ?? null,
        ...(manifest.logoUrl ? { iconUrl: manifest.logoUrl } : {}),
      });
    }
    return c.json({ plugins });
  })
  .get("/categories", async (c) => {
    const userId = sessionUserId(c);
    const categories = [];
    for (const id of NOTIFICATION_CATEGORIES) {
      const requiredPermission = NOTIFICATION_CATEGORY_PERMISSION[id];
      const allowed = await userHasPermission(userId, requiredPermission);
      categories.push({
        id,
        label: CATEGORY_LABELS[id].label,
        description: CATEGORY_LABELS[id].description,
        requiredPermission,
        allowed,
      });
    }
    return c.json({ categories });
  })
  .get("/channels", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS), async (c) => {
    const userId = sessionUserId(c);
    const capable = notificationCapablePluginIds();
    const all = await connectionsService.listForUser(userId);
    const channels = all
      .filter((conn) => capable.has(conn.pluginId))
      .map((conn) => ({
        ...conn,
        supportsKinds: manifestSupportsKinds(conn.pluginId),
      }));
    return c.json({ channels });
  })
  .post("/channels/:id/test", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS), async (c) => {
    const userId = sessionUserId(c);
    const id = c.req.param("id") as string;
    const capable = notificationCapablePluginIds();
    const db = getDb();
    const conn = await db
      .select()
      .from(serviceConnections)
      .where(and(eq(serviceConnections.id, id), eq(serviceConnections.userId, userId)))
      .get();
    if (!conn) throw notFound("notifications.channel_not_found", "channel not found");
    if (!capable.has(conn.pluginId)) {
      throw badRequest("notifications.not_a_channel", "connection is not a notification channel");
    }
    const result = await connectionsService.test({ userId, connectionId: id });
    return c.json(result);
  })
  .get("/subscriptions", requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS), async (c) => {
    const userId = sessionUserId(c);
    const capable = notificationCapablePluginIds();
    const userConns = await connectionsService.listForUser(userId);
    const channelIds = userConns.filter((c0) => capable.has(c0.pluginId)).map((c0) => c0.id);
    const subscriptions = await listSubscriptionsForConnections(channelIds);
    return c.json({ subscriptions });
  })
  .put(
    "/subscriptions/:connectionId/:category",
    requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS),
    zValidator("json", subscriptionUpdateBodySchema),
    async (c) => {
      const userId = sessionUserId(c);
      const connectionId = c.req.param("connectionId");
      const categoryRaw = c.req.param("category");
      if (!(NOTIFICATION_CATEGORIES as readonly string[]).includes(categoryRaw)) {
        throw badRequest("notifications.bad_category", "unknown category");
      }
      const category = categoryRaw as NotificationCategory;
      const required = NOTIFICATION_CATEGORY_PERMISSION[category];
      if (!(await userHasPermission(userId, required))) throw forbidden();

      const db = getDb();
      const conn = await db
        .select({ id: serviceConnections.id })
        .from(serviceConnections)
        .where(and(eq(serviceConnections.id, connectionId), eq(serviceConnections.userId, userId)))
        .get();
      if (!conn) throw notFound("notifications.channel_not_found", "channel not found");

      await upsertSubscription(connectionId, category, c.req.valid("json").enabled);
      return c.json({ ok: true });
    },
  )
  .post(
    "/subscriptions/bulk",
    requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS),
    zValidator("json", subscriptionsBulkBodySchema),
    async (c) => {
      const userId = sessionUserId(c);
      const { updates } = c.req.valid("json");
      if (updates.length > SUBSCRIPTION_BULK_LIMIT) {
        throw payloadTooLarge(
          "notifications.bulk_too_large",
          `at most ${SUBSCRIPTION_BULK_LIMIT} updates per request`,
        );
      }
      const db = getDb();
      const distinctIds = [...new Set(updates.map((u) => u.connectionId))];
      const owned = await db
        .select({ id: serviceConnections.id })
        .from(serviceConnections)
        .where(
          and(eq(serviceConnections.userId, userId), inArray(serviceConnections.id, distinctIds)),
        )
        .all();
      const ownedSet = new Set(owned.map((r) => r.id));
      for (const id of distinctIds) {
        if (!ownedSet.has(id)) {
          throw forbidden("notifications.foreign_channel", "channel does not belong to user");
        }
      }
      // Permission re-check per category.
      const distinctCategories = [...new Set(updates.map((u) => u.category))];
      for (const cat of distinctCategories) {
        if (!(await userHasPermission(userId, NOTIFICATION_CATEGORY_PERMISSION[cat]))) {
          throw forbidden();
        }
      }
      let count = 0;
      for (const u of updates) {
        await upsertSubscription(u.connectionId, u.category, u.enabled);
        count += 1;
      }
      return c.json({ updated: count });
    },
  )
  .get("/inbox", zValidator("query", inboxListQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const q = c.req.valid("query");
    const cursor = decodeInboxCursor(q.cursor);
    const items = await listInboxForUser(
      userId,
      { unreadOnly: q.unreadOnly, category: q.category, severity: q.severity },
      cursor,
      q.limit,
    );
    const unreadCount = await getUnreadCount(userId);
    const nextCursor =
      items.length === q.limit && items.length > 0
        ? encodeInboxCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
        : undefined;
    return c.json({
      items: items.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        readAt: row.readAt,
        title: row.title,
        body: row.body,
        severity: row.severity,
        category: row.category,
        actionUrl: row.actionUrl,
        image:
          row.imageUrl !== null
            ? { url: row.imageUrl, ...(row.imageAlt ? { alt: row.imageAlt } : {}) }
            : null,
      })),
      ...(nextCursor !== undefined ? { nextCursor } : {}),
      unreadCount,
    });
  })
  .get("/inbox/unread-count", async (c) => {
    const userId = sessionUserId(c);
    const count = await getUnreadCount(userId);
    return c.json({ count });
  })
  .post("/inbox/mark-read", zValidator("json", inboxMarkBodySchema), async (c) => {
    const userId = sessionUserId(c);
    const updated = await markInboxReadForUser(userId, c.req.valid("json").ids);
    return c.json({ updated });
  })
  .post("/inbox/mark-unread", zValidator("json", inboxMarkBodySchema), async (c) => {
    const userId = sessionUserId(c);
    const updated = await markInboxUnreadForUser(userId, c.req.valid("json").ids);
    return c.json({ updated });
  })
  .post("/inbox/mark-all-read", zValidator("json", inboxMarkAllReadBodySchema), async (c) => {
    const userId = sessionUserId(c);
    const { category } = c.req.valid("json");
    const updated = await markAllReadForUser(userId, category);
    return c.json({ updated });
  })
  .delete("/inbox", zValidator("json", inboxDeleteBodySchema), async (c) => {
    const userId = sessionUserId(c);
    const deleted = await deleteInboxForUser(userId, c.req.valid("json").ids);
    return c.json({ deleted });
  })
  .delete("/inbox/all", zValidator("json", inboxDeleteAllBodySchema), async (c) => {
    const userId = sessionUserId(c);
    const body = c.req.valid("json");
    const olderThanMs = body.olderThan ? Date.parse(body.olderThan) : undefined;
    const deleted = await deleteInboxAllForUser(userId, {
      readOnly: body.readOnly,
      ...(olderThanMs !== undefined ? { olderThanMs } : {}),
    });
    return c.json({ deleted });
  });

// ─── Admin procedures ──────────────────────────────────────────────────────

export const adminNotificationsApp = new Hono()
  .use("*", flagGate())
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_SERVER))
  .get("/deliveries", zValidator("query", adminDeliveriesQuerySchema), async (c) => {
    const q = c.req.valid("query");
    const cursor = q.cursor
      ? (() => {
          try {
            const decoded = Buffer.from(q.cursor!, "base64url").toString("utf8");
            const sep = decoded.indexOf(":");
            if (sep <= 0) throw new Error("malformed");
            const createdAt = Number(decoded.slice(0, sep));
            const id = decoded.slice(sep + 1);
            if (Number.isNaN(createdAt) || !id) throw new Error("malformed");
            return { createdAt, id };
          } catch {
            throw badRequest("notifications.bad_cursor", "invalid cursor");
          }
        })()
      : undefined;
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
    const last = rows[rows.length - 1];
    const nextCursor =
      rows.length === q.limit && last
        ? Buffer.from(`${last.createdAt}:${last.id}`, "utf8").toString("base64url")
        : undefined;
    return c.json({
      deliveries: rows.map((r) => ({
        id: r.id,
        eventId: r.eventId,
        eventType: r.eventType,
        status: r.status,
        recipientConnectionId: r.recipientConnectionId,
        recipientUserId: r.recipientUserId,
        attemptCount: r.attemptCount,
        lastError: r.lastError,
        lastErrorCode: r.lastErrorCode,
        providerMessageId: r.providerMessageId,
        correlationKey: r.correlationKey,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      })),
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
    return c.json({
      delivery: {
        id: row.id,
        eventId: row.eventId,
        eventType: row.eventType,
        status: row.status,
        recipientConnectionId: row.recipientConnectionId,
        recipientUserId: row.recipientUserId,
        attemptCount: row.attemptCount,
        lastError: row.lastError,
        lastErrorCode: row.lastErrorCode,
        providerMessageId: row.providerMessageId,
        correlationKey: row.correlationKey,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        eventPayload,
        attempts: [],
      },
    });
  })
  .post("/deliveries/:id/retry", async (c) => {
    const id = c.req.param("id");
    const db = getDb();
    const row = await db
      .select({ id: notificationDeliveries.id })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.id, id))
      .get();
    if (!row) throw notFound("notifications.delivery_not_found", "delivery not found");

    const reset = await resetDeliveryForRetry(id);
    if (!reset) throw notFound("notifications.delivery_not_found", "delivery not found");

    const jobEntry = find("notification.deliver");
    let rescheduled = false;
    if (jobEntry?.triggerFromApi) {
      await jobEntry.triggerFromApi(
        { deliveryId: id },
        { triggeredBy: "admin", requestId: newRequestId() },
      );
      rescheduled = true;
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
