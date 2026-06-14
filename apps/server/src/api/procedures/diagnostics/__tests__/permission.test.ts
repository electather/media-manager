import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../../__tests__/helpers/in-memory-db";
import { errorHandler, requestContextMiddleware } from "../../../../diagnostics/middleware";
import { user } from "../../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../../db/schema/auth/roles";

let db: Db;
let mockUserId: string | null = null;

vi.mock("../../../../env", () => ({
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

vi.mock("../../../../db/client", () => ({
  getDb: () => db,
}));

// The handlers behind the gate persist to / read from the DB. We are only
// asserting the permission gate, which short-circuits before any handler runs
// on the denial path, so a no-op capture keeps the import graph quiet.
vi.mock("../../../../diagnostics/capture", () => ({
  captureError: vi.fn(async () => "test-id"),
}));

// Tests drive permission semantics by seeding `role_permissions` / `user_roles`
// and exercise the REAL gate. better-auth fails to init under vitest, so we
// mirror the tiny role/permission helpers here exactly as production's
// `requirePermission` enforces them (auth/service.ts:116-128): a missing role
// or a missing permission throws `forbidden()` (403); the system-admin slug
// bypasses. `requirePermission` is NOT a pass-through — that is the whole point.
vi.mock("../../../../auth", async () => {
  const { unauthorized, forbidden } = await import("../../../../diagnostics/http-errors");
  const { eq, and } = await import("drizzle-orm");
  const { userRoles, roles, rolePermissions } = await import("../../../../db/schema/auth/roles");
  const { PERMISSIONS } = await import("@nama/shared/auth");
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
    requirePermission: (permission: string) => async (c: any, next: any) => {
      const session = c.get("session") as { user: { id: string } } | undefined;
      if (!session) throw unauthorized();
      const role = await loadUserRole(session.user.id);
      if (!role) throw forbidden();
      if (!(await roleHasPermission(role, permission))) throw forbidden();
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

const { adminDiagnosticsApp } = await import("../index");
const { adminErrorsApp } = await import("../errors");
const { adminPerfApp } = await import("../perf");

// One representative route per sub-app. Each module mounts
// `.use("*", requirePermission(PERMISSIONS.ADMIN_SERVER))`, so the gate runs
// before any handler-specific validation — the chosen paths only need to reach
// the gate, not produce a clean 200 on the allow path.
const ROUTES = [
  { name: "adminDiagnosticsApp GET /config", app: adminDiagnosticsApp, path: "/config" },
  { name: "adminErrorsApp GET /summary", app: adminErrorsApp, path: "/summary" },
  { name: "adminPerfApp GET /summary", app: adminPerfApp, path: "/summary" },
] as const;

function buildApp(app: Hono): Hono {
  return new Hono().use("*", requestContextMiddleware()).route("/", app).onError(errorHandler);
}

/**
 * Seeds a user with a custom (non-system) role granting exactly `permissions`.
 * A user passed `[]` holds a role with no permissions. Pass `null` for
 * `permissions` to leave the user with no role assignment at all.
 */
async function seedUser(userId: string, permissions: string[] | null): Promise<void> {
  await db.insert(user).values({
    id: userId,
    name: userId,
    email: `${userId}@example.com`,
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  if (permissions === null) return;
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

beforeEach(async () => {
  db = await createInMemoryDb();
  mockUserId = null;
});

afterAll(() => cleanupInMemoryDbs());

describe("admin diagnostics — ADMIN_SERVER gate", () => {
  // The core guarantee from issue #562: holding `admin:plugins` is NOT enough.
  // If any sub-app's gate were downgraded to `ADMIN_PLUGINS` (or removed), the
  // matching assertion below would see 200/other instead of 403 and fail.
  describe("a caller holding ONLY admin:plugins is denied (403)", () => {
    for (const route of ROUTES) {
      it(`${route.name} → 403`, async () => {
        const userId = `plugins-only-${crypto.randomUUID()}`;
        await seedUser(userId, ["admin:plugins"]);
        mockUserId = userId;
        const res = await buildApp(route.app).request(route.path);
        expect(res.status).toBe(403);
      });
    }
  });

  describe("a caller with no role assigned is denied (403)", () => {
    for (const route of ROUTES) {
      it(`${route.name} → 403`, async () => {
        const userId = `no-role-${crypto.randomUUID()}`;
        await seedUser(userId, null);
        mockUserId = userId;
        const res = await buildApp(route.app).request(route.path);
        expect(res.status).toBe(403);
      });
    }
  });

  // Contrast: the gate is permission-specific, not a blanket deny. A caller
  // holding `admin:server` passes the gate. We assert the request is NOT
  // rejected by the gate (status !== 403). The handler may then return 200 or
  // some other status depending on its own logic, but it must reach past the
  // permission check.
  describe("a caller holding admin:server passes the gate", () => {
    for (const route of ROUTES) {
      it(`${route.name} → not 403`, async () => {
        const userId = `server-admin-${crypto.randomUUID()}`;
        await seedUser(userId, ["admin:server"]);
        mockUserId = userId;
        const res = await buildApp(route.app).request(route.path);
        expect(res.status).not.toBe(403);
        expect(res.status).toBe(200);
      });
    }
  });
});
