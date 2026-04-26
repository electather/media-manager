import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { errorHandler, requestContextMiddleware } from "../../../errors/middleware";
import {
  notificationDeliveries,
  notificationsInbox,
  notificationSubscriptions,
} from "../../../db/schema/notifications";
import { user } from "../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../db/schema/roles";
import { plugins } from "../../../db/schema/plugins";
import { serviceConnections } from "../../../db/schema/credentials";

// ─── Mocks set up before importing the app ──────────────────────────────────

let db: Db;
let mockUserId: string | null = null;
let notificationsEnabled = true;

vi.mock("../../../env", () => ({
  env: new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "NOTIFICATIONS_ENABLED") return notificationsEnabled;
        if (key === "APP_EXTERNAL_URL") return "http://localhost";
        return undefined;
      },
    },
  ),
}));

vi.mock("../../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../../../auth/middleware", async () => {
  const { unauthorized } = await import("../../../errors/http-errors");
  return {
    requireSession: async (c: any, next: any) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: any) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
    requirePermission: () => async (_c: any, next: any) => {
      // Permission gate is enforced by the inner per-user lookup against
      // role_permissions via userHasPermission(); this stub keeps the
      // middleware out of the way so test arrangement controls the outcome.
      await next();
    },
  };
});

const mockCapabilityRegistry = {
  providers: new Map<string, { manifest: any }>(),
  listProviders(_cap: string, _ver: string, _scope: string): string[] {
    return Array.from(this.providers.keys());
  },
  get(id: string) {
    const entry = this.providers.get(id);
    if (!entry) return undefined;
    return { module: { manifest: entry.manifest }, pluginId: id, enabled: true };
  },
  reset() {
    this.providers.clear();
  },
};

vi.mock("../../../plugin-runtime/registry", () => ({
  capabilityRegistry: mockCapabilityRegistry,
}));

vi.mock("../../../connections/service", () => ({
  connectionsService: {
    listForUser: async (userId: string) => {
      const rows = await db
        .select()
        .from(serviceConnections)
        .where((row: any) => row)
        .all();
      return rows
        .filter((r) => r.userId === userId)
        .map((r) => ({
          id: r.id,
          pluginId: r.pluginId,
          status: r.status,
          enabled: r.enabled === 1,
          isDefault: r.isDefault === 1,
          displayName: r.displayName,
          tokenExpiresAt: r.tokenExpiresAt,
          lastVerifiedAt: r.lastVerifiedAt,
          errorMessage: r.errorMessage,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          displayFields: [],
          plugin: {
            id: r.pluginId,
            name: r.pluginId,
            version: "0.0.0",
            description: "",
            authKind: "none",
            poolable: false,
            userScopedCapabilities: [],
            globalScopedCapabilities: [],
            userConfigSchema: null,
            credentialsSchema: null,
            adminSharedAvailable: false,
          },
        }));
    },
    test: async () => ({ ok: true, message: "stub ok" }),
  },
}));

vi.mock("../../../jobs/registry", () => ({
  find: () => undefined,
}));

const { notificationsApp, adminNotificationsApp } = await import("../notifications");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/notifications", notificationsApp)
    .route("/admin/notifications", adminNotificationsApp)
    .onError(errorHandler);
}

async function seedUser(userId: string, permissions: string[] = []): Promise<void> {
  await db.insert(user).values({ id: userId, name: userId, email: `${userId}@example.com` });
  const roleId = `role-${userId}`;
  await db.insert(roles).values({
    id: roleId,
    name: `r-${userId}`,
    description: null,
    isSystem: 0,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(userRoles).values({ userId, roleId, assignedAt: 0 });
  for (const p of permissions) {
    await db.insert(rolePermissions).values({ roleId, permission: p });
  }
}

async function seedConnection(args: { id: string; userId: string; pluginId: string }) {
  await db
    .insert(plugins)
    .values({
      id: args.pluginId,
      version: "0.0.0",
      sourceUrl: `builtin:${args.pluginId}`,
      sourceType: "builtin",
      checksum: "0",
      enabled: 1,
      manifest: JSON.stringify({
        id: args.pluginId,
        name: args.pluginId,
        version: "0.0.0",
        description: "",
        sdkVersion: "^1.0.0",
        author: { name: "test" },
        allowedHosts: [],
        auth: { kind: "none" },
        capabilities: { notificationDelivery: { version: "v1", scope: "user" } },
      }),
      installedAt: 0,
      updatedAt: 0,
    })
    .onConflictDoNothing();
  await db.insert(serviceConnections).values({
    id: args.id,
    userId: args.userId,
    pluginId: args.pluginId,
    status: "connected",
    encryptedCredentials: "",
    credentialsIv: "",
    userConfig: "{}",
    enabled: 1,
    isDefault: 0,
    displayName: null,
    tokenExpiresAt: null,
    lastVerifiedAt: null,
    errorMessage: null,
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(async () => {
  db = await createInMemoryDb();
  notificationsEnabled = true;
  mockUserId = null;
  mockCapabilityRegistry.reset();
});

afterAll(() => cleanupInMemoryDbs());

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("notifications HTTP — flag gating", () => {
  it("returns 404 on every notif route when feature flag is off", async () => {
    notificationsEnabled = false;
    mockUserId = "u1";
    const app = buildApp();
    for (const path of [
      "/notifications/plugins",
      "/notifications/categories",
      "/notifications/inbox",
      "/admin/notifications/deliveries",
    ]) {
      const res = await app.request(path);
      expect(res.status, `${path}`).toBe(404);
    }
  });
});

describe("notifications HTTP — auth", () => {
  it("returns 401 without session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/notifications/categories");
    expect(res.status).toBe(401);
  });
});

describe("notifications HTTP — categories endpoint", () => {
  it("flags `allowed=false` for categories the user lacks permission for", async () => {
    mockUserId = "u1";
    await seedUser("u1", ["account:connections"]); // no admin:server, no media:activity.
    const res = await buildApp().request("/notifications/categories");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { categories: Array<{ id: string; allowed: boolean }> };
    const byId = Object.fromEntries(body.categories.map((c) => [c.id, c.allowed]));
    expect(byId.media).toBe(false);
    expect(byId.system).toBe(false);
    expect(byId.sync).toBe(true);
    expect(byId.auth).toBe(true);
  });
});

describe("notifications HTTP — plugins endpoint", () => {
  it("returns only providers of notificationDelivery@v1 with their supportsKinds", async () => {
    mockUserId = "u1";
    await seedUser("u1");
    mockCapabilityRegistry.providers.set("inbox", {
      manifest: {
        id: "inbox",
        name: "In-app inbox",
        description: "Inbox provider",
        auth: { kind: "none" },
        capabilities: {
          notificationDelivery: {
            version: "v1",
            scope: "user",
            supportsKinds: ["text", "markdown"],
          },
        },
      },
    });
    const res = await buildApp().request("/notifications/plugins");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      plugins: Array<{ id: string; supportsKinds: string[] }>;
    };
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0]?.id).toBe("inbox");
    expect(body.plugins[0]?.supportsKinds).toEqual(["text", "markdown"]);
  });
});

describe("notifications HTTP — bulk subscriptions", () => {
  it("rejects payloads above SUBSCRIPTION_BULK_LIMIT with 400 (zod) before route runs", async () => {
    mockUserId = "u1";
    await seedUser("u1", ["account:connections"]);
    const updates = Array.from({ length: 201 }, () => ({
      connectionId: "c1",
      category: "media",
      enabled: true,
    }));
    const res = await buildApp().request("/notifications/subscriptions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ updates }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects updates referencing connections not owned by the user with 403", async () => {
    mockUserId = "u1";
    await seedUser("u1", ["account:connections", "media:activity"]);
    await seedUser("u2");
    await seedConnection({ id: "c-other", userId: "u2", pluginId: "inbox" });
    const res = await buildApp().request("/notifications/subscriptions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        updates: [{ connectionId: "c-other", category: "media", enabled: true }],
      }),
    });
    expect(res.status).toBe(403);
  });

  it("upserts subscription rows for owned channels", async () => {
    mockUserId = "u1";
    await seedUser("u1", ["account:connections", "media:activity"]);
    await seedConnection({ id: "c1", userId: "u1", pluginId: "inbox" });
    const res = await buildApp().request("/notifications/subscriptions/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        updates: [{ connectionId: "c1", category: "media", enabled: true }],
      }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(notificationSubscriptions).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.enabled).toBe(1);
  });
});

describe("notifications HTTP — inbox listing & scoping", () => {
  it("only lists rows belonging to the session user, ordered newest first, with cursor", async () => {
    mockUserId = "u1";
    await seedUser("u1");
    await seedUser("u2");
    const ids = ["a", "b", "c", "d"];
    for (const id of ids) {
      await db.insert(notificationsInbox).values({
        id: `${id}-mine`,
        deliveryId: null,
        userId: "u1",
        title: id,
        body: id,
        severity: "info",
        category: "media",
        actionUrl: null,
        imageUrl: null,
        imageAlt: null,
        readAt: null,
        createdAt: id.charCodeAt(0),
      });
    }
    await db.insert(notificationsInbox).values({
      id: "foreign",
      deliveryId: null,
      userId: "u2",
      title: "no",
      body: "",
      severity: "info",
      category: "media",
      actionUrl: null,
      imageUrl: null,
      imageAlt: null,
      readAt: null,
      createdAt: 99,
    });

    const first = await buildApp().request("/notifications/inbox?limit=2");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { items: Array<{ id: string }>; nextCursor?: string };
    expect(firstBody.items.map((i) => i.id)).toEqual(["d-mine", "c-mine"]);
    expect(firstBody.nextCursor).toBeTruthy();

    const second = await buildApp().request(
      `/notifications/inbox?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor!)}`,
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as { items: Array<{ id: string }> };
    expect(secondBody.items.map((i) => i.id)).toEqual(["b-mine", "a-mine"]);
  });

  it("mark-read & delete are scoped to the session user — foreign rows untouched", async () => {
    mockUserId = "u1";
    await seedUser("u1");
    await seedUser("u2");
    await db.insert(notificationsInbox).values([
      {
        id: "mine",
        deliveryId: null,
        userId: "u1",
        title: "x",
        body: "",
        severity: "info",
        category: "media",
        actionUrl: null,
        imageUrl: null,
        imageAlt: null,
        readAt: null,
        createdAt: 1,
      },
      {
        id: "foreign",
        deliveryId: null,
        userId: "u2",
        title: "x",
        body: "",
        severity: "info",
        category: "media",
        actionUrl: null,
        imageUrl: null,
        imageAlt: null,
        readAt: null,
        createdAt: 1,
      },
    ]);

    // Try to mark both rows; only mine flips.
    const res = await buildApp().request("/notifications/inbox/mark-read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: ["mine", "foreign"] }),
    });
    const body = (await res.json()) as { updated: number };
    expect(body.updated).toBe(1);
    const all = await db.select().from(notificationsInbox).all();
    const byId = Object.fromEntries(all.map((r) => [r.id, r.readAt]));
    expect(byId.mine).not.toBeNull();
    expect(byId.foreign).toBeNull();
  });

  it("rejects malformed cursors with 400", async () => {
    mockUserId = "u1";
    await seedUser("u1");
    const res = await buildApp().request("/notifications/inbox?cursor=not-base64-or-anything");
    expect(res.status).toBe(400);
  });
});

describe("notifications HTTP — admin retry resets and reschedules", () => {
  it("resets attempt_count to 0 and flips status back to pending", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    await db.insert(notificationDeliveries).values({
      id: "d1",
      eventId: "e1",
      eventType: "system.error",
      eventPayload: JSON.stringify({ id: "e1", type: "system.error" }),
      recipientConnectionId: null,
      recipientUserId: "admin-1",
      status: "failed",
      attemptCount: 5,
      lastError: "boom",
      lastErrorCode: "x",
      providerMessageId: null,
      correlationKey: null,
      createdAt: 1,
      updatedAt: 1,
    });

    const res = await buildApp().request("/admin/notifications/deliveries/d1/retry", {
      method: "POST",
    });
    expect(res.status).toBe(200);
    const row = await db.select().from(notificationDeliveries).all();
    expect(row[0]?.status).toBe("pending");
    expect(row[0]?.attemptCount).toBe(0);
    expect(row[0]?.lastError).toBeNull();
  });
});

describe("notifications HTTP — admin settings persistence", () => {
  it("PATCH then GET round-trips clamped values", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    const patchRes = await buildApp().request("/admin/notifications/settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ inboxRetentionDays: 60, deliveryRetentionDays: 14 }),
    });
    expect(patchRes.status).toBe(200);
    const getRes = await buildApp().request("/admin/notifications/settings");
    expect(getRes.status).toBe(200);
    expect(await getRes.json()).toEqual({
      inboxRetentionDays: 60,
      deliveryRetentionDays: 14,
    });
  });
});
