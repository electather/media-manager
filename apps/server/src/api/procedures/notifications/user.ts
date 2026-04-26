import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_PERMISSION,
  type NotificationCategory,
  inboxDeleteAllBodySchema,
  inboxDeleteBodySchema,
  inboxListQuerySchema,
  inboxMarkAllReadBodySchema,
  inboxMarkBodySchema,
  subscriptionUpdateBodySchema,
  subscriptionsBulkBodySchema,
} from "@ent-mcp/shared/notifications";
import {
  loadUserRole,
  requirePermission,
  requireSession,
  roleHasPermission,
  sessionUserId,
  userHasPermission,
} from "../../../auth/middleware";
import { PERMISSIONS } from "../../../auth/permissions";
import { connectionsService } from "../../../connections/service";
import { getDb } from "../../../db/client";
import { serviceConnections } from "../../../db/schema";
import { badRequest, forbidden, notFound, payloadTooLarge } from "../../../errors/http-errors";
import { zValidator } from "../../../errors/validator";
import { capabilityRegistry } from "../../../plugin-runtime/registry";
import {
  deleteInboxAllForUser,
  deleteInboxForUser,
  getUnreadCount,
  inboxRowToDto,
  listInboxForUser,
  listSubscriptionsForConnections,
  markAllReadForUser,
  markInboxReadForUser,
  markInboxUnreadForUser,
  upsertSubscription,
} from "../../../notifications/repos";
import {
  CATEGORY_LABELS,
  SUBSCRIPTION_BULK_LIMIT,
  assertCanWriteCategories,
  assertOwnsConnections,
  decodeKeysetCursor,
  encodeKeysetCursor,
  flagGate,
  manifestSupportsKinds,
  notificationCapablePluginIds,
} from "./helpers";

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
    // Load the role row once and re-check it per category instead of issuing
    // 4× full role+permission lookups. The category permission table is small
    // and the system Admin shortcut short-circuits without a second query.
    const role = await loadUserRole(userId);
    const categories = [];
    for (const id of NOTIFICATION_CATEGORIES) {
      const requiredPermission = NOTIFICATION_CATEGORY_PERMISSION[id];
      const allowed = role ? await roleHasPermission(role, requiredPermission) : false;
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
      await assertOwnsConnections(userId, [...new Set(updates.map((u) => u.connectionId))]);
      await assertCanWriteCategories(userId, [...new Set(updates.map((u) => u.category))]);
      for (const u of updates) {
        await upsertSubscription(u.connectionId, u.category, u.enabled);
      }
      return c.json({ updated: updates.length });
    },
  )
  .get("/inbox", zValidator("query", inboxListQuerySchema), async (c) => {
    const userId = sessionUserId(c);
    const q = c.req.valid("query");
    const cursor = decodeKeysetCursor(q.cursor);
    const items = await listInboxForUser(
      userId,
      { unreadOnly: q.unreadOnly, category: q.category, severity: q.severity },
      cursor,
      q.limit,
    );
    const unreadCount = await getUnreadCount(userId);
    const nextCursor =
      items.length === q.limit && items.length > 0
        ? encodeKeysetCursor(items[items.length - 1]!.createdAt, items[items.length - 1]!.id)
        : undefined;
    return c.json({
      items: items.map(inboxRowToDto),
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
