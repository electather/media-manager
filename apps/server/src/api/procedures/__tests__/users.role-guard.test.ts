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
  const { PERMISSIONS } = await import("@nama/shared/auth");
  // The handler now creates users via the direct-insert helpers (sign-up is
  // disabled). Delegate to the REAL helpers — they need only getDb() (mocked to
  // the in-memory db above) and the schema, not the betterAuth instance — so the
  // test exercises the actual user + account + user_roles writes.
  const { createUser, createUserWithRole } = await import("../../../auth/internal/create-user");
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
    PERMISSIONS,
    SYSTEM_ADMIN_ROLE_SLUG: "admin",
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
import { roles, userRoles } from "../../../db/schema/auth/roles";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { adminUsersApp } from "../users";

const ACTING_ADMIN_ID = "acting-admin";
const TARGET_ID = "target-user";
const ADMIN_ROLE_ID = "role_admin";
const MEMBER_ROLE_ID = "role_member";

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
});
