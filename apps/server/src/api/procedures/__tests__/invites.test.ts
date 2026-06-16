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
    TRUST_PROXY: false,
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

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { rolePermissions, roles, userRoles } from "../../../db/schema/auth/roles";
import { invites } from "../../../db/schema/auth/invites";
import { PERMISSIONS } from "@nama/shared/auth";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { adminInvitesApp, invitesApp, acceptIpLimiter } from "../invites";

const ACTING_ADMIN_ID = "acting-admin";
const ADMIN_ROLE_ID = "role_admin";
const MEMBER_ROLE_ID = "role_member";
const CUSTOM_ADMIN_ROLE_ID = "role_custom_admin";

function buildApp() {
  return new Hono()
    .use("*", requestContextMiddleware())
    .route("/admin/invites", adminInvitesApp)
    .route("/invites", invitesApp)
    .onError(errorHandler);
}

const FUTURE_EXPIRY = Date.now() + 7 * 24 * 60 * 60 * 1000;

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
    {
      id: MEMBER_ROLE_ID,
      name: "Member",
      isSystem: 1,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: CUSTOM_ADMIN_ROLE_ID,
      name: "Custom Admin",
      isSystem: 0,
      createdAt: 0,
      updatedAt: 0,
    },
  ]);

  await db
    .insert(rolePermissions)
    .values([{ roleId: CUSTOM_ADMIN_ROLE_ID, permission: PERMISSIONS.ADMIN_USERS }]);
}

beforeEach(async () => {
  db = await createInMemoryDb();
  mockUserId = ACTING_ADMIN_ID;
  // Reset the accept rate limiter so accumulated usage from earlier tests doesn't
  // cause spurious 429s when tests share the same resolved IP (empty string in test).
  acceptIpLimiter.reset();
});

afterAll(() => cleanupInMemoryDbs());

// ─── Role-assignability guard ─────────────────────────────────────────────────

describe("POST /admin/invites — role assignability guard", () => {
  beforeEach(seedBaseData);

  it("returns 403 when creating an invite for the system Admin role", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: ADMIN_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 1 }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.system_role");
  });

  it("returns 403 when creating an invite for a custom role that grants an admin-tier permission", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: CUSTOM_ADMIN_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 1 }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("users.admin_role");
  });

  it("returns 201 and creates the invite for a regular role", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ roleId: MEMBER_ROLE_ID, expiresAt: FUTURE_EXPIRY, maxUses: 5 }),
    });

    expect(res.status).toBe(201);
    const dto = (await res.json()) as { id: string; code: string; url: string; expired: boolean };
    expect(dto.code).toBeDefined();
    expect(dto.url).toContain("/auth/invite/");
    expect(dto.expired).toBe(false);
  });
});

// ─── Accept happy path ────────────────────────────────────────────────────────

describe("POST /invites/:code/accept — happy path", () => {
  beforeEach(seedBaseData);

  it("creates the user + credential account with emailVerified=true, assigns role, increments uses", async () => {
    const code = "TEST01-MEMBER-INVITE";
    await db.insert(invites).values({
      id: "inv_test_1",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 1000),
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
        password: "password-1234567890",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string };
    expect(body.ok).toBe(true);
    expect(body.userId).toBeDefined();

    // Verify the user was created with the correct role and emailVerified=true.
    const createdUser = await db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, "newuser@example.com"))
      .get();
    expect(createdUser).toBeDefined();
    expect(createdUser?.emailVerified).toBe(true);

    const assignedRole = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, body.userId))
      .get();
    expect(assignedRole?.roleId).toBe(MEMBER_ROLE_ID);

    // Uses incremented.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    expect(inv?.uses).toBe(1);
  });
});

// ─── 410 cases ────────────────────────────────────────────────────────────────

describe("POST /invites/:code/accept — 410 cases", () => {
  beforeEach(seedBaseData);

  it("returns 410 when the invite has expired", async () => {
    const code = "EXPIRE-INVITE-TEST1";
    await db.insert(invites).values({
      id: "inv_expired",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 10000),
      // Expiry in the past.
      expiresAt: new Date(Date.now() - 1000),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Late User",
        email: "late@example.com",
        password: "password-1234567890",
      }),
    });

    expect(res.status).toBe(410);
  });

  it("returns 410 when uses >= maxUses (exhausted)", async () => {
    const code = "EXHAUST-INVITE-TEST";
    await db.insert(invites).values({
      id: "inv_exhausted",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      // Already at the cap.
      uses: 1,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Extra User",
        email: "extra@example.com",
        password: "password-1234567890",
      }),
    });

    expect(res.status).toBe(410);
  });

  it("returns 410 when the invite has been revoked", async () => {
    const code = "REVOKED-INVITE-TEST";
    await db.insert(invites).values({
      id: "inv_revoked",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
      revokedAt: new Date(Date.now() - 500),
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blocked User",
        email: "blocked@example.com",
        password: "password-1234567890",
      }),
    });

    expect(res.status).toBe(410);
  });
});

// ─── 409 duplicate email — uses rolled back ────────────────────────────────────

describe("POST /invites/:code/accept — 409 duplicate email", () => {
  beforeEach(seedBaseData);

  it("returns 409 for a duplicate email and does NOT consume a use", async () => {
    const code = "DUP-EMAIL-INVITE-01";
    await db.insert(invites).values({
      id: "inv_dup",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // The admin account already has this email.
    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Admin Copy",
        email: "admin@example.com",
        password: "password-1234567890",
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

// ─── Sequential double-accept (atomic guard) ──────────────────────────────────

describe("POST /invites/:code/accept — sequential double-accept", () => {
  beforeEach(seedBaseData);

  it("second accept returns 410 after the first saturates maxUses=1", async () => {
    const code = "DOUBLE-ACCEPT-TEST1";
    await db.insert(invites).values({
      id: "inv_double",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 1000),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 0,
    });

    const first = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First User",
        email: "first@example.com",
        password: "password-1234567890",
      }),
    });
    expect(first.status).toBe(200);

    const second = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second User",
        email: "second@example.com",
        password: "password-1234567890",
      }),
    });
    // The first accept saturated maxUses=1; the atomic guard rejects the second.
    expect(second.status).toBe(410);
  });
});

// ─── GET /admin/invites — list excludes revoked ────────────────────────────────

describe("GET /admin/invites — list behavior", () => {
  beforeEach(seedBaseData);

  it("excludes revoked invites from the list", async () => {
    await db.insert(invites).values([
      {
        id: "inv_active",
        code: "ACTIVE-INVITE-CODE1",
        roleId: MEMBER_ROLE_ID,
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now() - 1000),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 5,
        uses: 0,
      },
      {
        id: "inv_revok",
        code: "REVOKED-LIST-INVITE",
        roleId: MEMBER_ROLE_ID,
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now() - 2000),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 5,
        uses: 0,
        revokedAt: new Date(),
      },
    ]);

    const res = await buildApp().request("/admin/invites");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: Array<{ id: string; expired: boolean }> };
    const ids = body.invites.map((i) => i.id);
    expect(ids).toContain("inv_active");
    expect(ids).not.toContain("inv_revok");
  });

  it("reports computed expired=true for an invite past its expiresAt", async () => {
    await db.insert(invites).values({
      id: "inv_past",
      code: "PAST-EXPIRY-INVITE1",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 10000),
      expiresAt: new Date(Date.now() - 1000),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request("/admin/invites");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: Array<{ id: string; expired: boolean }> };
    const past = body.invites.find((i) => i.id === "inv_past");
    expect(past?.expired).toBe(true);
  });
});
