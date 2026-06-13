import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import {
  notificationDeliveries,
  notificationsInbox,
  notificationSubscriptions,
} from "../../../db/schema/notifications";
import { user } from "../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../db/schema/auth/roles";
import { plugins } from "../../../db/schema/plugin-runtime/plugins";
import { serviceConnections } from "../../../db/schema/plugin-runtime/credentials";

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

vi.mock("../../../auth", async () => {
  // Reimplement the role / permission helpers against the in-memory db so
  // tests drive permission semantics by seeding role_permissions rows. We
  // avoid `importOriginal()` here because the real module pulls in
  // better-auth, which fails to init under test env. The helpers are tiny
  // and the duplication is intentional — keep the queries in lockstep with
  // auth/middleware.ts when one of them changes.
  const { unauthorized } = await import("../../../diagnostics/http-errors");
  const { eq, and } = await import("drizzle-orm");
  const { userRoles, roles, rolePermissions } = await import("../../../db/schema/auth/roles");
  const { PERMISSIONS } = await import("@nama/shared/auth");
  type RoleInfo = { roleId: string; isSystemAdmin: boolean };
  async function loadUserRole(userId: string): Promise<RoleInfo | null> {
    const row = await db
      .select({ roleId: userRoles.roleId, systemSlug: roles.systemSlug })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .get();
    if (!row) return null;
    return { roleId: row.roleId, isSystemAdmin: row.systemSlug === "admin" };
  }
  async function roleHasPermission(role: RoleInfo, permission: string): Promise<boolean> {
    if (role.isSystemAdmin) return true;
    const allowed = await db
      .select({ permission: rolePermissions.permission })
      .from(rolePermissions)
      .where(
        and(eq(rolePermissions.roleId, role.roleId), eq(rolePermissions.permission, permission)),
      )
      .get();
    return !!allowed;
  }
  async function userHasPermission(userId: string, permission: string): Promise<boolean> {
    const r = await loadUserRole(userId);
    return r ? roleHasPermission(r, permission) : false;
  }
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
      // Outer requirePermission middleware is bypassed in tests because the
      // real route handlers re-check the per-category permission. Tests
      // arrange role_permissions rows to drive outcomes.
      await next();
    },
    loadUserRole,
    roleHasPermission,
    userHasPermission,
    PERMISSIONS,
  };
});

const { mockCapabilityRegistry } = vi.hoisted(() => ({
  mockCapabilityRegistry: {
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
  },
}));

vi.mock("../../../plugin-runtime", async () => {
  const actual =
    await vi.importActual<typeof import("../../../plugin-runtime")>("../../../plugin-runtime");
  return {
    ...actual,
    capabilityRegistry: mockCapabilityRegistry,
  };
});

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
    // Mirror the production helper by reading from the mock capability
    // registry. Each entry exposes the same `PluginSummary` fields the real
    // implementation derives from manifests; the notifications endpoint
    // layers `supportsKinds` on top.
    listNotificationPlugins: async (ids: ReadonlySet<string>) => {
      const out: any[] = [];
      for (const id of ids) {
        const entry = mockCapabilityRegistry.get(id);
        if (!entry) continue;
        const manifest = entry.module.manifest as any;
        out.push({
          id,
          name: manifest.name ?? id,
          version: manifest.version ?? "0.0.0",
          description: manifest.description ?? "",
          logoUrl: manifest.logoUrl,
          authKind: manifest.auth?.kind ?? "none",
          poolable: manifest.poolable ?? false,
          userScopedCapabilities: Object.entries(manifest.capabilities ?? {})
            .filter(([, c]: [string, any]) => c.scope === "user")
            .map(([capId, c]: [string, any]) => ({ id: capId, version: c.version })),
          globalScopedCapabilities: Object.entries(manifest.capabilities ?? {})
            .filter(([, c]: [string, any]) => c.scope === "global")
            .map(([capId, c]: [string, any]) => ({ id: capId, version: c.version })),
          userConfigSchema: manifest.userConfigSchema ?? null,
          credentialsSchema: manifest.credentialsSchema ?? null,
          adminSharedAvailable: false,
        });
      }
      return out;
    },
    test: async () => ({ ok: true, message: "stub ok" }),
  },
}));

vi.mock("../../../jobs/registry", () => ({
  findEntry: () => undefined,
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

async function seedPlugin(pluginId: string) {
  await db.insert(plugins).values({
    id: pluginId,
    version: "0.0.0",
    sourceUrl: `builtin:${pluginId}`,
    sourceType: "builtin",
    checksum: "0",
    enabled: 1,
    manifest: JSON.stringify({
      id: pluginId,
      name: pluginId,
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
  });
}

async function seedConnection(args: { id: string; userId: string; pluginId: string }) {
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
  it("rejects payloads above SUBSCRIPTION_BULK_LIMIT with 413", async () => {
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
    expect(res.status).toBe(413);
  });

  it("still rejects payloads above the parser hard ceiling with 400", async () => {
    mockUserId = "u1";
    await seedUser("u1", ["account:connections"]);
    const updates = Array.from({ length: 1001 }, () => ({
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
    await seedPlugin("inbox");
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
    await seedPlugin("inbox");
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

describe("notifications HTTP — admin deliveries query validation", () => {
  it("rejects non-numeric `from` with 400 instead of binding NaN to the query", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    const res = await buildApp().request("/admin/notifications/deliveries?from=notanumber");
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric `to` with 400", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    const res = await buildApp().request("/admin/notifications/deliveries?to=foo");
    expect(res.status).toBe(400);
  });
});

describe("notifications HTTP — admin retry resets and reschedules", () => {
  it("refuses to retry a row currently in_progress with 409", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    await db.insert(notificationDeliveries).values({
      id: "d-inflight",
      eventId: "e1",
      eventType: "system.error",
      eventPayload: JSON.stringify({ id: "e1", type: "system.error" }),
      recipientConnectionId: null,
      recipientUserId: "admin-1",
      status: "in_progress",
      attemptCount: 1,
      lastError: null,
      lastErrorCode: null,
      providerMessageId: null,
      correlationKey: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const res = await buildApp().request("/admin/notifications/deliveries/d-inflight/retry", {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const row = await db.select().from(notificationDeliveries).all();
    // Row left untouched — attempt count and status unchanged.
    expect(row[0]?.status).toBe("in_progress");
    expect(row[0]?.attemptCount).toBe(1);
  });

  it("returns 404 for unknown delivery id", async () => {
    mockUserId = "admin-1";
    await seedUser("admin-1", ["admin:server"]);
    const res = await buildApp().request("/admin/notifications/deliveries/missing/retry", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("uses an atomic conditional UPDATE (resetDeliveryForRetry never overwrites in_progress)", async () => {
    // Regression for the prior SELECT-then-UPDATE TOCTOU race: even if the
    // row transitions to in_progress between the read and the write, the
    // single conditional UPDATE will not flip it back to pending. We
    // exercise the repo helper directly so we don't depend on timing.
    const { resetDeliveryForRetry } = await import("../../../notifications/repo/deliveries");
    await seedUser("u-x");
    await db.insert(notificationDeliveries).values({
      id: "d-atomic",
      eventId: "e1",
      eventType: "system.error",
      eventPayload: JSON.stringify({ id: "e1", type: "system.error" }),
      recipientConnectionId: null,
      recipientUserId: "u-x",
      status: "in_progress",
      attemptCount: 2,
      lastError: null,
      lastErrorCode: null,
      providerMessageId: null,
      correlationKey: null,
      createdAt: 1,
      updatedAt: 1,
    });
    const result = await resetDeliveryForRetry("d-atomic");
    expect(result).toBe("in_progress");
    const row = await db.select().from(notificationDeliveries).all();
    expect(row[0]?.status).toBe("in_progress");
    expect(row[0]?.attemptCount).toBe(2);
  });

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

describe("notifications HTTP — inbox ?after forward cursor", () => {
  async function seedInboxRow(userId: string, id: string, createdAt: number) {
    await db.insert(notificationsInbox).values({
      id,
      deliveryId: null,
      userId,
      title: id,
      body: id,
      severity: "info",
      category: "media",
      actionUrl: null,
      imageUrl: null,
      imageAlt: null,
      readAt: null,
      createdAt,
    });
  }

  it("returns all items after the cursor in ASC order", async () => {
    mockUserId = "u-fwd";
    await seedUser("u-fwd");
    // Seed 5 rows with distinct ascending timestamps.
    await seedInboxRow("u-fwd", "r1", 100);
    await seedInboxRow("u-fwd", "r2", 200);
    await seedInboxRow("u-fwd", "r3", 300);
    await seedInboxRow("u-fwd", "r4", 400);
    await seedInboxRow("u-fwd", "r5", 500);

    // Construct a cursor pointing to (createdAt=50, id="r0") — before all seeded rows.
    const { encodeKeysetCursor } = await import("../notifications/helpers");
    const beforeAll = encodeKeysetCursor(50, "r0");

    const res = await buildApp().request(
      `/notifications/inbox?after=${encodeURIComponent(beforeAll)}&limit=10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; createdAt: number }> };
    expect(body.items.map((i) => i.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
    // Verify strictly ascending order by createdAt.
    const times = body.items.map((i) => i.createdAt);
    expect(times).toEqual([100, 200, 300, 400, 500]);
  });

  it("returns 400 when both cursor and after are present", async () => {
    mockUserId = "u-fwd";
    await seedUser("u-fwd");
    const { encodeKeysetCursor } = await import("../notifications/helpers");
    const cursor = encodeKeysetCursor(100, "r1");
    const res = await buildApp().request(
      `/notifications/inbox?cursor=${encodeURIComponent(cursor)}&after=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message?: string };
    expect(JSON.stringify(body)).toContain("cursor_and_after_mutually_exclusive");
  });

  it("returns empty items and no nextCursor when after points past the newest row", async () => {
    mockUserId = "u-fwd";
    await seedUser("u-fwd");
    await seedInboxRow("u-fwd", "r1", 100);

    const { encodeKeysetCursor } = await import("../notifications/helpers");
    const afterLast = encodeKeysetCursor(999, "zzz");

    const res = await buildApp().request(
      `/notifications/inbox?after=${encodeURIComponent(afterLast)}&limit=10`,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; nextCursor?: string };
    expect(body.items).toHaveLength(0);
    expect(body.nextCursor).toBeUndefined();
  });
});
