import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Hono } from "hono";
import { eq } from "drizzle-orm";

vi.mock("../../../env", () => ({
  env: {
    CACHE_PROVIDER: "memory",
    ENCRYPTION_KEY: "test-key",
    SQLITE_PATH: "file::memory:",
    BETTER_AUTH_SECRET: "x".repeat(32),
    BETTER_AUTH_URL: "http://localhost",
    APP_EXTERNAL_URL: "http://localhost",
  },
}));

let db: Db;
let mockUserId: string | null = "acting-admin";

vi.mock("../../../db/client", () => ({
  getDb: () => db,
}));

vi.mock("../../../auth", async () => {
  const { unauthorized } = await import("../../../diagnostics/http-errors");
  const { PERMISSIONS, ADMIN_PERMISSIONS } = await import("@nama/shared/auth");
  // The handler now creates users via the direct-insert helpers (sign-up is
  // disabled). Delegate to the REAL helpers — they need only getDb() (mocked to
  // the in-memory db above) and the schema, not the betterAuth instance — so the
  // test exercises the actual user + account + user_roles writes.
  const { createUser, createUserWithRole } = await import("../../../auth/internal/create-user");
  // Delegate the capability check to the REAL repo query against the in-memory
  // db so the guard exercises actual permission-row resolution, not a stub.
  const { roleHasAnyPermission } = await import("../../../auth/repo");
  // Use the real slug constant + the real shared admin-perm set so the mock
  // tracks production: the guard blocks ANY admin:* permission, not a subset.
  const { SYSTEM_ADMIN_ROLE_SLUG } = await import("../../../auth/types");
  return {
    requireSession: async (c: any, next: any) => {
      if (!mockUserId) throw unauthorized();
      c.set("session", { user: { id: mockUserId } });
      await next();
    },
    sessionUserId: (c: any) => {
      const s = c.get("session") as { user: { id: string } } | undefined;
      if (!s) throw unauthorized();
      return s.user.id;
    },
    requirePermission: () => async (_c: any, next: any) => {
      await next();
    },
    roleHasAdminTierPermission: async (roleId: string, systemSlug: string | null) => {
      if (systemSlug === SYSTEM_ADMIN_ROLE_SLUG) return true;
      return roleHasAnyPermission(roleId, ADMIN_PERMISSIONS);
    },
    PERMISSIONS,
    SYSTEM_ADMIN_ROLE_SLUG,
    createUser,
    createUserWithRole,
  };
});

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { rolePermissions, roles, userRoles } from "../../../db/schema/auth/roles";
import { PERMISSIONS } from "@nama/shared/auth";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { adminUsersApp } from "../users";

const ACTING_ADMIN_ID = "acting-admin";
const TARGET_ID = "target-user";
const ADMIN_ROLE_ID = "role_admin";
const MEMBER_ROLE_ID = "role_member";
// Custom (non-system-slug) role that holds an admin-tier permission row — an
// admin in capability but not in slug. The guard must reject it.
const CUSTOM_ADMIN_ROLE_ID = "role_custom_admin";
// Custom role with a benign, non-admin permission — must stay assignable.
const CUSTOM_VIEWER_ROLE_ID = "role_custom_viewer";
// Custom roles carrying other admin:* permissions. These are also escalation
// vectors — the caller sets the new account's password and could log in as it —
// so the broadened guard must reject every admin:* permission, not just
// users/roles.
const CUSTOM_ROLES_ROLE_ID = "role_custom_roles";
const CUSTOM_SERVER_ROLE_ID = "role_custom_server";

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/admin/users", adminUsersApp)
    .onError(errorHandler);
}

async function seedBaseData() {
  await db.insert(user).values([
    { id: ACTING_ADMIN_ID, name: "Admin", email: "admin@example.com" },
    { id: TARGET_ID, name: "Target", email: "target@example.com" },
  ]);

  await db.insert(roles).values([
    {
      id: ADMIN_ROLE_ID,
      name: "Admin",
      isSystem: 1,
      systemSlug: "admin",
      createdAt: 0,
      updatedAt: 0,
    },
    { id: MEMBER_ROLE_ID, name: "Member", isSystem: 1, createdAt: 0, updatedAt: 0 },
    // Custom roles have no systemSlug — they only differ by their permission rows.
    { id: CUSTOM_ADMIN_ROLE_ID, name: "Custom Admin", isSystem: 0, createdAt: 0, updatedAt: 0 },
    { id: CUSTOM_VIEWER_ROLE_ID, name: "Custom Viewer", isSystem: 0, createdAt: 0, updatedAt: 0 },
    { id: CUSTOM_ROLES_ROLE_ID, name: "Custom Roles", isSystem: 0, createdAt: 0, updatedAt: 0 },
    { id: CUSTOM_SERVER_ROLE_ID, name: "Custom Server", isSystem: 0, createdAt: 0, updatedAt: 0 },
  ]);

  await db.insert(rolePermissions).values([
    // Admin-tier capability via a custom role — the escalation path #576 closes.
    { roleId: CUSTOM_ADMIN_ROLE_ID, permission: PERMISSIONS.ADMIN_USERS },
    // A benign permission that must NOT trip the guard.
    { roleId: CUSTOM_VIEWER_ROLE_ID, permission: PERMISSIONS.MEDIA_DISCOVER },
    // The other arm of the privilege-granting pair.
    { roleId: CUSTOM_ROLES_ROLE_ID, permission: PERMISSIONS.ADMIN_ROLES },
    // A non-users/roles admin permission — only blocked once the guard covers
    // the full admin:* set.
    { roleId: CUSTOM_SERVER_ROLE_ID, permission: PERMISSIONS.ADMIN_SERVER },
  ]);
}

beforeEach(async () => {
  db = await createInMemoryDb();
  mockUserId = ACTING_ADMIN_ID;
});

afterAll(() => cleanupInMemoryDbs());

// ─── DB shape tests ──────────────────────────────────────────────────────────
// Verify the schema properties the guard condition depends on.

describe("users role-assignment guard: DB shape", () => {
  beforeEach(seedBaseData);

  it("Admin role carries the guard condition (systemSlug='admin')", async () => {
    const row = await db
      .select({ id: roles.id, systemSlug: roles.systemSlug })
      .from(roles)
      .where(eq(roles.id, ADMIN_ROLE_ID))
      .get();

    expect(row?.systemSlug).toBe("admin");
  });

  it("Member role has isSystem=1 but no admin slug — does NOT match the guard condition", async () => {
    const row = await db
      .select({ id: roles.id, isSystem: roles.isSystem, systemSlug: roles.systemSlug })
      .from(roles)
      .where(eq(roles.id, MEMBER_ROLE_ID))
      .get();

    expect(row?.isSystem).toBe(1);
    expect(row?.systemSlug).toBeNull();
  });
});

// ─── HTTP handler tests ──────────────────────────────────────────────────────
// These tests call the actual Hono handlers and assert on HTTP status codes.

describe("PUT /admin/users/:id/role — system Admin guard", () => {
  beforeEach(seedBaseData);

  it("returns 403 when assigning the Admin role", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: ADMIN_ROLE_ID }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.system_role");
  });

  it("returns 200 and assigns the role when assigning a non-Admin role", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: MEMBER_ROLE_ID }),
    });

    expect(res.status).toBe(200);

    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();
    expect(assigned?.roleId).toBe(MEMBER_ROLE_ID);
  });
});

// ─── Capability-based guard (issue #576) ─────────────────────────────────────
// The slug-only guard let a custom role carrying admin:users / admin:roles
// through. These assert the guard now blocks on capability while leaving benign
// custom roles assignable. They FAIL against the old slug-only guard.

describe("PUT /admin/users/:id/role — admin-capability guard", () => {
  beforeEach(seedBaseData);

  it("returns 403 when assigning a custom role that holds an admin-tier permission", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_ADMIN_ROLE_ID }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");

    // The guard rejects before the upsert — no role assignment is persisted.
    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();
    expect(assigned).toBeUndefined();
  });

  it("returns 200 for a custom role that holds only a non-admin permission (guard not over-broad)", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_VIEWER_ROLE_ID }),
    });

    expect(res.status).toBe(200);

    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();
    expect(assigned?.roleId).toBe(CUSTOM_VIEWER_ROLE_ID);
  });

  it("returns 403 when assigning a custom role that holds admin:roles", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_ROLES_ROLE_ID }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");
  });

  it("returns 403 when assigning a custom role that holds a non-users/roles admin permission (admin:server)", async () => {
    const res = await buildApp().request(`/admin/users/${TARGET_ID}/role`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_SERVER_ROLE_ID }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");

    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();
    expect(assigned).toBeUndefined();
  });
});

describe("POST /admin/users — system Admin guard on new user creation", () => {
  beforeEach(seedBaseData);

  it("returns 403 when creating a user with the Admin role", async () => {
    const res = await buildApp().request("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "new@example.com",
        password: "password123",
        roleId: ADMIN_ROLE_ID,
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.system_role");
    // The guard rejects before any insert, so no user row is created.
    const created = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "new@example.com"))
      .get();
    expect(created).toBeUndefined();
  });

  it("returns 201 and assigns the role when creating a user with a non-Admin role", async () => {
    const res = await buildApp().request("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "new@example.com",
        password: "password123",
        roleId: MEMBER_ROLE_ID,
      }),
    });

    expect(res.status).toBe(201);
    const { userId: newUserId } = (await res.json()) as { userId: string };

    // The direct-insert helper created the user and assigned the member role.
    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, newUserId))
      .get();
    expect(assigned?.roleId).toBe(MEMBER_ROLE_ID);
  });

  it("returns 403 when creating a user with a custom admin-capability role", async () => {
    const res = await buildApp().request("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "new@example.com",
        password: "password123",
        roleId: CUSTOM_ADMIN_ROLE_ID,
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");
    // The guard rejects before any insert, so no user row is created.
    const created = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "new@example.com"))
      .get();
    expect(created).toBeUndefined();
  });

  it("returns 201 when creating a user with a custom non-admin role (guard not over-broad)", async () => {
    const res = await buildApp().request("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "viewer@example.com",
        password: "password123",
        roleId: CUSTOM_VIEWER_ROLE_ID,
      }),
    });

    expect(res.status).toBe(201);
    const { userId: newUserId } = (await res.json()) as { userId: string };

    const assigned = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, newUserId))
      .get();
    expect(assigned?.roleId).toBe(CUSTOM_VIEWER_ROLE_ID);
  });

  it("returns 403 when creating a user with a custom admin:server role (password-set escalation)", async () => {
    const res = await buildApp().request("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "server@example.com",
        password: "password-1234",
        roleId: CUSTOM_SERVER_ROLE_ID,
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");
    const created = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "server@example.com"))
      .get();
    expect(created).toBeUndefined();
  });
});
