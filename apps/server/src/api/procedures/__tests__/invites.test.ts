/**
 * Tests for `POST /admin/invites`, `GET /admin/invites`, `POST /admin/invites/:id/extend`,
 * `DELETE /admin/invites/:id`, and `POST /invites/:code/accept`.
 *
 * Mirrors the harness pattern of `users.role-guard.test.ts`: in-memory SQLite +
 * mocked auth middleware. The accept tests exercise the full transaction path
 * including the atomic use-count guard and the duplicate-email rollback.
 */
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
  const { roleHasAnyPermission } = await import("../../../auth/repo");
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
  };
});

// Mock the rate limiters so tests never hit a capacity ceiling.
vi.mock("../../../api/rate-limit", () => ({
  publicIpRateLimit: async (_c: any, next: any) => next(),
  acceptIpRateLimit: async (_c: any, next: any) => next(),
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../db/schema/auth/roles";
import { invites } from "../../../db/schema/auth/invites";
import { account } from "../../../db/schema/auth";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { adminInvitesApp, invitesApp } from "../invites";

const ACTING_ADMIN_ID = "acting-admin";
const ADMIN_ROLE_ID = "role_admin";
const MEMBER_ROLE_ID = "role_member";
// A custom role that holds an admin-tier permission — must not be invite-able.
const CUSTOM_ADMIN_ROLE_ID = "role_custom_admin";

const FUTURE_EXPIRY = Date.now() + 7 * 24 * 60 * 60 * 1000;

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/admin/invites", adminInvitesApp)
    .route("/invites", invitesApp)
    .onError(errorHandler);
}

async function seedBaseData() {
  await db
    .insert(user)
    .values([{ id: ACTING_ADMIN_ID, name: "Admin", email: "admin@example.com" }]);

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
    { id: CUSTOM_ADMIN_ROLE_ID, name: "Custom Admin", isSystem: 0, createdAt: 0, updatedAt: 0 },
  ]);

  await db
    .insert(rolePermissions)
    .values([{ roleId: CUSTOM_ADMIN_ROLE_ID, permission: "admin:users" }]);
}

beforeEach(async () => {
  db = await createInMemoryDb();
  mockUserId = ACTING_ADMIN_ID;
});

afterAll(() => cleanupInMemoryDbs());

// ─── Role-guard tests ─────────────────────────────────────────────────────────

describe("POST /admin/invites — role-assignability guard", () => {
  beforeEach(seedBaseData);

  it("returns 403 when inviting to the system Admin role", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: ADMIN_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 1 }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.system_role");
  });

  it("returns 403 when inviting to a custom role holding an admin-tier permission", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_ADMIN_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 1 }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");
  });

  it("returns 201 when inviting to a regular non-admin role", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: MEMBER_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 1 }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { code: string; url: string };
    expect(typeof body.code).toBe("string");
    expect(body.url).toContain(body.code);
  });
});

// ─── Accept happy path ────────────────────────────────────────────────────────

describe("POST /invites/:code/accept — happy path", () => {
  it("creates user+credential with emailVerified=true, assigns role, and increments uses", async () => {
    await seedBaseData();

    // Seed a valid invite.
    const code = "TEST01-ABCDEF-GHIJKL";
    await db.insert(invites).values({
      id: "inv-1",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New User",
        email: "newuser@example.com",
        password: "password-longer-than-12",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string };
    expect(body.ok).toBe(true);
    expect(typeof body.userId).toBe("string");

    // User was created with emailVerified=true.
    const createdUser = await db
      .select({ emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, "newuser@example.com"))
      .get();
    expect(createdUser?.emailVerified).toBe(true);

    // Role was assigned.
    const assignedRole = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, body.userId))
      .get();
    expect(assignedRole?.roleId).toBe(MEMBER_ROLE_ID);

    // A credential account row was written for sign-in.
    const credAccount = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, body.userId))
      .get();
    expect(credAccount?.providerId).toBe("credential");

    // Use count was incremented.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    expect(inv?.uses).toBe(1);
  });
});

// ─── Accept 410 paths ─────────────────────────────────────────────────────────

describe("POST /invites/:code/accept — 410 paths", () => {
  beforeEach(seedBaseData);

  it("returns 410 for an expired invite", async () => {
    const code = "EXPIRED-000000-AAAAAA";
    await db.insert(invites).values({
      id: "inv-expired",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() - 1_000), // already expired
      maxUses: 1,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });

    expect(res.status).toBe(410);
  });

  it("returns 410 for an exhausted invite (uses >= maxUses)", async () => {
    const code = "EXHAUS-111111-BBBBBB";
    await db.insert(invites).values({
      id: "inv-exhausted",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 1, // already exhausted
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });

    expect(res.status).toBe(410);
  });

  it("returns 410 for a revoked invite", async () => {
    const code = "REVOKE-222222-CCCCCC";
    await db.insert(invites).values({
      id: "inv-revoked",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 0,
      revokedAt: new Date(Date.now()),
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });

    expect(res.status).toBe(410);
  });
});

// ─── Accept 409 — duplicate email with rollback ───────────────────────────────

describe("POST /invites/:code/accept — 409 duplicate email", () => {
  it("returns 409 and does NOT consume a use when the email is already registered", async () => {
    await seedBaseData();

    // Pre-existing user with the same email.
    await db
      .insert(user)
      .values({ id: "existing-user", name: "Existing", email: "taken@example.com" });

    const code = "DUPEML-333333-DDDDDD";
    await db.insert(invites).values({
      id: "inv-dup",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "New",
        email: "taken@example.com",
        password: "password-longer-12",
      }),
    });

    expect(res.status).toBe(409);

    // The transaction rolled back — uses must still be 0.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    expect(inv?.uses).toBe(0);
  });
});

// ─── Sequential double-accept respects maxUses ────────────────────────────────

describe("POST /invites/:code/accept — maxUses=1 sequential double-accept", () => {
  it("first request succeeds, second returns 410 after the cap is reached", async () => {
    await seedBaseData();

    const code = "MAXUSE-444444-EEEEEE";
    await db.insert(invites).values({
      id: "inv-single-use",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 0,
    });

    const first = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First",
        email: "first@example.com",
        password: "password-longer-12",
      }),
    });
    expect(first.status).toBe(200);

    const second = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second",
        email: "second@example.com",
        password: "password-longer-12",
      }),
    });
    expect(second.status).toBe(410);
  });
});

// ─── GET /admin/invites — excludes revoked, reports expired ──────────────────

describe("GET /admin/invites", () => {
  it("excludes revoked rows and reports computed expired for expired invites", async () => {
    await seedBaseData();

    await db.insert(invites).values([
      {
        id: "inv-active",
        code: "ACTIVE-AAAAAA-BBBBBB",
        roleId: MEMBER_ROLE_ID,
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now()),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 5,
        uses: 0,
      },
      {
        id: "inv-expired",
        code: "EXPIRY-CCCCCC-DDDDDD",
        roleId: MEMBER_ROLE_ID,
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now() - 10_000),
        expiresAt: new Date(Date.now() - 1_000),
        maxUses: 5,
        uses: 0,
      },
      {
        id: "inv-revoked",
        code: "REVOKE-EEEEEE-FFFFFF",
        roleId: MEMBER_ROLE_ID,
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now()),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 5,
        uses: 0,
        revokedAt: new Date(Date.now()),
      },
    ]);

    const res = await buildApp().request("/admin/invites");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: { id: string; expired: boolean }[] };

    // Revoked invite must not appear.
    const ids = body.invites.map((i) => i.id);
    expect(ids).not.toContain("inv-revoked");

    // Active invite is present and not expired.
    const active = body.invites.find((i) => i.id === "inv-active");
    expect(active).toBeDefined();
    expect(active?.expired).toBe(false);

    // Expired invite is present but flagged.
    const expired = body.invites.find((i) => i.id === "inv-expired");
    expect(expired).toBeDefined();
    expect(expired?.expired).toBe(true);
  });
});
