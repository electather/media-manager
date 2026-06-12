import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { user } from "../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../db/schema/auth/roles";
import { plugins } from "../../../db/schema/plugin-runtime/plugins";
import { serviceConnections } from "../../../db/schema/plugin-runtime/credentials";
import { primaryConnections } from "../../../db/schema/preferences/user-preferences";

let db: Db;
let mockUserId: string | null = null;
const invalidateUserCacheMock = vi.fn();

vi.mock("../../../env", () => ({
  env: new Proxy(
    {},
    {
      get(_t, key) {
        if (key === "ENCRYPTION_KEY") return "0123456789abcdef0123456789abcdef";
        if (key === "CACHE_PROVIDER") return "memory";
        return undefined;
      },
    },
  ),
}));

vi.mock("../../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../../../auth", async () => {
  // Tests drive permission semantics by seeding `role_permissions`. The real
  // module pulls in better-auth which fails to init under vitest; mirror the
  // tiny role/permission helpers here so the gate matches production.
  const { unauthorized, forbidden } = await import("../../../diagnostics/http-errors");
  const { eq, and } = await import("drizzle-orm");
  const { userRoles, roles, rolePermissions } = await import("../../../db/schema/auth/roles");
  const { PERMISSIONS } = await import("@ent-mcp/shared/auth");
  async function loadUserRole(userId: string) {
    const row = await db
      .select({ roleId: userRoles.roleId, systemSlug: roles.systemSlug })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .get();
    if (!row) return null;
    return { roleId: row.roleId, isSystemAdmin: row.systemSlug === "admin" };
  }
  async function roleHasPermission(
    role: { roleId: string; isSystemAdmin: boolean },
    permission: string,
  ): Promise<boolean> {
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
  return {
    requireSession: async (c: any, next: any) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    requirePermission: (permission: string) => async (_c: any, next: any) => {
      if (!mockUserId) throw unauthorized();
      const role = await loadUserRole(mockUserId);
      if (!role || !(await roleHasPermission(role, permission))) throw forbidden();
      await next();
    },
    sessionUserId: (c: any) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      return session.user.id;
    },
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
  return { ...actual, capabilityRegistry: mockCapabilityRegistry };
});

vi.mock("../../../media", async () => {
  const { setPrimaryConnection, clearPrimaryConnection, getPrimaryConnection } =
    await import("../../../media/service/primary-preference");
  return {
    setPrimaryConnection,
    clearPrimaryConnection,
    getPrimaryConnection,
    invalidateUserCache: (...args: unknown[]) => invalidateUserCacheMock(...args),
  };
});

const { connectionsPrimaryApp } = await import("../connections-primary");

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .use("*", async (c, next) => {
      // Re-import the mocked auth module so the same `mockUserId` state drives
      // both the session check here and the `requirePermission` middleware
      // mounted inside the sub-app.
      const { requireSession, requirePermission, PERMISSIONS } = await import("../../../auth");
      return requireSession(c, async () => {
        return requirePermission(PERMISSIONS.ACCOUNT_CONNECTIONS)(c, next);
      });
    })
    .route("/connections/primary", connectionsPrimaryApp)
    .onError(errorHandler);
}

async function seedUser(userId: string, permissions: string[] = ["account:connections"]) {
  await db.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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

async function seedPlugin(
  pluginId: string,
  capabilities: Record<string, { version: string; scope: "user" | "global" }> = {
    metadata: { version: "v1", scope: "user" },
  },
) {
  await db.insert(plugins).values({
    id: pluginId,
    version: "1.0.0",
    sourceUrl: `builtin:${pluginId}`,
    sourceType: "builtin",
    checksum: "0",
    enabled: 1,
    personalKeyFallback: "off",
    manifest: JSON.stringify({
      id: pluginId,
      name: pluginId,
      version: "1.0.0",
      description: "",
      sdkVersion: "^1.0.0",
      author: { name: "test" },
      allowedHosts: [],
      auth: { kind: "none" },
      capabilities,
    }),
    installedAt: 0,
    updatedAt: 0,
  });
  mockCapabilityRegistry.providers.set(pluginId, {
    manifest: { id: pluginId, name: pluginId, capabilities },
  });
}

async function seedConnection(args: {
  id: string;
  userId: string;
  pluginId: string;
}): Promise<void> {
  await db.insert(serviceConnections).values({
    id: args.id,
    userId: args.userId,
    pluginId: args.pluginId,
    status: "connected",
    enabled: 1,
    isDefault: 0,
    encryptedCredentials: "",
    credentialsIv: "",
    userConfig: "{}",
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
  mockUserId = null;
  mockCapabilityRegistry.reset();
  invalidateUserCacheMock.mockReset();
});

afterAll(() => cleanupInMemoryDbs());

// Proper v4 UUIDs — `z.string().uuid()` enforces the standard format.
const MOVIE_PRIMARY = "11111111-1111-4111-8111-111111111111";
const TV_PRIMARY = "22222222-2222-4222-8222-222222222222";
const FOREIGN_CONN = "33333333-3333-4333-8333-333333333333";

describe("connections/primary — auth gating", () => {
  it("returns 401 without session", async () => {
    mockUserId = null;
    const res = await buildApp().request("/connections/primary");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the caller lacks ACCOUNT_CONNECTIONS", async () => {
    await seedUser("u1", []); // no permissions
    mockUserId = "u1";
    const res = await buildApp().request("/connections/primary");
    expect(res.status).toBe(403);
  });
});

describe("connections/primary — GET", () => {
  it("returns only the caller's rows with mediaType sentinel mapped to null", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedPlugin("tmdb");
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "tmdb" });
    await seedConnection({ id: FOREIGN_CONN, userId: "u2", pluginId: "tmdb" });
    // Caller's row (mediaType: movie).
    await db.insert(primaryConnections).values({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: MOVIE_PRIMARY,
      updatedAt: Date.now(),
    });
    // Caller's row with sentinel mediaType.
    await db.insert(primaryConnections).values({
      userId: "u1",
      capabilityKey: "watchlist@v1",
      mediaType: "_",
      connectionId: MOVIE_PRIMARY,
      updatedAt: Date.now(),
    });
    // Foreign row — must NOT appear in the response.
    await db.insert(primaryConnections).values({
      userId: "u2",
      capabilityKey: "metadata@v1",
      mediaType: "tv",
      connectionId: FOREIGN_CONN,
      updatedAt: Date.now(),
    });

    mockUserId = "u1";
    const res = await buildApp().request("/connections/primary");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      primaries: Array<{
        capabilityKey: string;
        mediaType: "movie" | "tv" | null;
        connectionId: string;
      }>;
    };
    expect(body.primaries).toEqual(
      expect.arrayContaining([
        { capabilityKey: "metadata@v1", mediaType: "movie", connectionId: MOVIE_PRIMARY },
        { capabilityKey: "watchlist@v1", mediaType: null, connectionId: MOVIE_PRIMARY },
      ]),
    );
    expect(body.primaries).toHaveLength(2);
  });
});

describe("connections/primary — POST", () => {
  it("rejects a foreign connectionId with 404 connection.not_found", async () => {
    await seedUser("u1");
    await seedUser("u2");
    await seedPlugin("tmdb");
    await seedConnection({ id: FOREIGN_CONN, userId: "u2", pluginId: "tmdb" });
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: FOREIGN_CONN,
      }),
    });
    expect(res.status).toBe(404);
    expect(((await res.json()) as { code: string }).code).toBe("connection.not_found");
    expect(invalidateUserCacheMock).not.toHaveBeenCalled();
  });

  it("rejects when plugin manifest doesn't advertise the capability with 422", async () => {
    await seedUser("u1");
    // Plugin only advertises `watchlist@v1` at user scope — picker for `metadata@v1` must 422.
    await seedPlugin("trakt", { watchlist: { version: "v1", scope: "user" } });
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "trakt" });
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: MOVIE_PRIMARY,
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("connection.capability_unsupported");
    expect(invalidateUserCacheMock).not.toHaveBeenCalled();
  });

  it("rejects a connection whose plugin advertises the capability at the wrong scope with 422", async () => {
    await seedUser("u1");
    await seedPlugin("tmdb", { metadata: { version: "v1", scope: "global" } });
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "tmdb" });
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: MOVIE_PRIMARY,
      }),
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("connection.capability_unsupported");
  });

  it("upserts the primary row and calls invalidateUserCache on the happy path", async () => {
    await seedUser("u1");
    await seedPlugin("tmdb");
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "tmdb" });
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: MOVIE_PRIMARY,
      }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    expect(invalidateUserCacheMock).toHaveBeenCalledWith("u1");

    const rows = await db.select().from(primaryConnections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectionId).toBe(MOVIE_PRIMARY);
    expect(rows[0]?.mediaType).toBe("movie");
  });

  it("upserts on second POST so the latest connectionId wins (#458 API regression)", async () => {
    // Locks in the issue-#458 atomic upsert contract at the API layer: two
    // POSTs to the same (capability, mediaType) tuple must leave exactly one
    // row with the most-recent connectionId, not duplicate or 500.
    await seedUser("u1");
    await seedPlugin("tmdb");
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "tmdb" });
    await seedConnection({ id: TV_PRIMARY, userId: "u1", pluginId: "tmdb" });
    mockUserId = "u1";
    const app = buildApp();

    await app.request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: MOVIE_PRIMARY,
      }),
    });
    const res = await app.request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "metadata@v1",
        mediaType: "movie",
        connectionId: TV_PRIMARY,
      }),
    });
    expect(res.status).toBe(200);
    const rows = await db.select().from(primaryConnections).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.connectionId).toBe(TV_PRIMARY);
  });

  it("rejects an invalid capabilityKey shape with 400", async () => {
    await seedUser("u1");
    mockUserId = "u1";
    const res = await buildApp().request("/connections/primary", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityKey: "not-a-capability",
        mediaType: "movie",
        connectionId: MOVIE_PRIMARY,
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe("connections/primary — DELETE", () => {
  it("removes an existing row and calls invalidateUserCache", async () => {
    await seedUser("u1");
    await seedPlugin("tmdb");
    await seedConnection({ id: MOVIE_PRIMARY, userId: "u1", pluginId: "tmdb" });
    await db.insert(primaryConnections).values({
      userId: "u1",
      capabilityKey: "metadata@v1",
      mediaType: "movie",
      connectionId: MOVIE_PRIMARY,
      updatedAt: Date.now(),
    });
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capabilityKey: "metadata@v1", mediaType: "movie" }),
    });
    expect(res.status).toBe(200);
    expect(invalidateUserCacheMock).toHaveBeenCalledWith("u1");
    const rows = await db.select().from(primaryConnections).all();
    expect(rows).toHaveLength(0);
  });

  it("returns 200 when the row does not exist (idempotent)", async () => {
    await seedUser("u1");
    mockUserId = "u1";

    const res = await buildApp().request("/connections/primary", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capabilityKey: "metadata@v1", mediaType: "tv" }),
    });
    expect(res.status).toBe(200);
  });
});
