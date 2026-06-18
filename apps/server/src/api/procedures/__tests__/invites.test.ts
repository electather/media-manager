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
import { eq, sql } from "drizzle-orm";

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
  createProductionLikeDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { roles, rolePermissions, userRoles } from "../../../db/schema/auth/roles";
import { invites } from "../../../db/schema/auth/invites";
import { account } from "../../../db/schema/auth";
import { errorHandler, requestContextMiddleware } from "../../../diagnostics/middleware";
import { adminInvitesApp, invitesApp, isEmailUniqueViolation } from "../invites";

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
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);

    // User was created with emailVerified=true.
    const createdUser = await db
      .select({ id: user.id, emailVerified: user.emailVerified })
      .from(user)
      .where(eq(user.email, "newuser@example.com"))
      .get();
    expect(createdUser).not.toBeNull();
    const newUserId = createdUser!.id;
    expect(createdUser!.emailVerified).toBe(true);

    // Role was assigned.
    const assignedRole = await db
      .select({ roleId: userRoles.roleId })
      .from(userRoles)
      .where(eq(userRoles.userId, newUserId))
      .get();
    expect(assignedRole?.roleId).toBe(MEMBER_ROLE_ID);

    // A credential account row was written for sign-in.
    const credAccount = await db
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, newUserId))
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

// ─── Accept role re-validation at consumption (#852 L1a/L1b) ──────────────────

describe("POST /invites/:code/accept — role re-validation at consumption", () => {
  beforeEach(seedBaseData);

  // L1a: the #576 escalation guard runs at creation, but a role can gain an
  // admin-tier permission after the invite is minted. Accepting must re-check so
  // an unauthenticated stranger is never granted a now-admin-tier role.
  it("returns 403 and does NOT consume a use when the bound role gained an admin-tier permission after minting", async () => {
    const code = "ESCAL8-555555-FFFFFF";
    await db.insert(invites).values({
      id: "inv-escalate",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // The role becomes admin-tier *after* the invite exists.
    await db.insert(rolePermissions).values({ roleId: MEMBER_ROLE_ID, permission: "admin:users" });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "X",
        email: "escalate@example.com",
        password: "password-longer-12",
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.admin_role");

    // The rejection rolled back the increment — no use was burned.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    expect(inv?.uses).toBe(0);
  });

  // L1b: a role deleted after the invite was minted leaves the invite pointing at
  // a missing role. The preview already returns 410 for this; accept must agree
  // rather than assign a permissionless ghost role / hit the role_id FK. (FK is
  // disabled only to *create* the orphan state — which production's enforced FK
  // would otherwise block — not to test it.)
  it("returns 410 and does NOT consume a use when the bound role was deleted after minting", async () => {
    const code = "ORPHAN-666666-AAAAAA";
    await db.insert(invites).values({
      id: "inv-orphan",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // Orphan the invite: drop the role with FK enforcement off, then restore it.
    // try/finally ensures FK enforcement is always re-enabled even if the delete
    // throws — otherwise subsequent tests in this file would run with FKs off.
    await db.run(sql`PRAGMA foreign_keys=OFF`);
    try {
      await db.delete(roles).where(eq(roles.id, MEMBER_ROLE_ID));
    } finally {
      await db.run(sql`PRAGMA foreign_keys=ON`);
    }

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "X",
        email: "orphan@example.com",
        password: "password-longer-12",
      }),
    });

    expect(res.status).toBe(410);

    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.code, code))
      .get();
    expect(inv?.uses).toBe(0);
  });
});

// ─── Foreign-key enforcement (#852 M1) ────────────────────────────────────────

// Runs against a PRODUCTION-LIKE db — WAL + busy_timeout only, NO explicit
// `PRAGMA foreign_keys` (just like getDb()+initDb()). This proves libSQL enforces
// FKs by its per-connection default; using the FK-on `createInMemoryDb` helper
// here would be a tautology that asserts nothing about the production path.
describe("invites foreign-key enforcement (production connection setup)", () => {
  let prodDb: Db;

  beforeEach(async () => {
    prodDb = await createProductionLikeDb();
    await prodDb.insert(roles).values({
      id: MEMBER_ROLE_ID,
      name: "Member",
      isSystem: 1,
      createdAt: 0,
      updatedAt: 0,
    });
    await prodDb
      .insert(user)
      .values({ id: ACTING_ADMIN_ID, name: "Admin", email: "a@example.com" });
  });

  it("reports foreign_keys ON without any explicit PRAGMA", async () => {
    const row = (await prodDb.get(sql`PRAGMA foreign_keys`)) as
      | { foreign_keys: number }
      | undefined;
    expect(row?.foreign_keys).toBe(1);
  });

  // Locks the production guarantee that `invited_by … ON DELETE SET NULL` fires:
  // deleting the creating admin must null the column, not leave a dangling id.
  it("nulls invited_by when the creating admin is deleted (ON DELETE SET NULL)", async () => {
    await prodDb.insert(invites).values({
      id: "inv-fk",
      code: "FKTEST-777777-BBBBBB",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // Production deletes the user with a plain (non-tx) delete (users.ts).
    await prodDb.delete(user).where(eq(user.id, ACTING_ADMIN_ID));

    const inv = await prodDb
      .select({ invitedBy: invites.invitedBy })
      .from(invites)
      .where(eq(invites.id, "inv-fk"))
      .get();
    expect(inv?.invitedBy).toBeNull();
  });

  it("rejects an invite insert that references a non-existent role (role_id FK enforced)", async () => {
    await expect(
      prodDb.insert(invites).values({
        id: "inv-bad-fk",
        code: "BADFK0-888888-CCCCCC",
        roleId: "role_does_not_exist",
        invitedBy: ACTING_ADMIN_ID,
        createdAt: new Date(Date.now()),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 1,
        uses: 0,
      }),
    ).rejects.toThrow();
  });
});

// ─── isEmailUniqueViolation matcher (#852 L1c) ────────────────────────────────

// A true concurrent same-email accept race is not reproducible under single-writer
// in-memory SQLite, so the catch→409 mapping is verified at the matcher level: it
// must recognise the user.email UNIQUE violation across driver wordings without
// rewriting an unrelated UNIQUE failure (which would mask a different bug).
describe("isEmailUniqueViolation", () => {
  it("matches the user.email UNIQUE violation by message", () => {
    expect(isEmailUniqueViolation(new Error("UNIQUE constraint failed: user.email"))).toBe(true);
  });

  it("matches the SQLite code form scoped to user.email", () => {
    const err = Object.assign(new Error("constraint failed on user.email"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expect(isEmailUniqueViolation(err)).toBe(true);
  });

  it("does NOT match an unrelated UNIQUE violation", () => {
    expect(isEmailUniqueViolation(new Error("UNIQUE constraint failed: invites.code"))).toBe(false);
    const codeErr = Object.assign(new Error("UNIQUE constraint failed: invites.code"), {
      code: "SQLITE_CONSTRAINT_UNIQUE",
    });
    expect(isEmailUniqueViolation(codeErr)).toBe(false);
  });

  it("does NOT match a non-error value", () => {
    expect(isEmailUniqueViolation("nope")).toBe(false);
    expect(isEmailUniqueViolation(null)).toBe(false);
  });
});

// ─── GET /invites/:code — public preview ─────────────────────────────────────

describe("GET /invites/:code", () => {
  beforeEach(seedBaseData);

  it("returns the role name and expiry for an active invite", async () => {
    const code = "PREVIEW-AAAAAA-111111";
    await db.insert(invites).values({
      id: "inv-preview-ok",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roleName: string; expiresAt: number };
    expect(body.roleName).toBe("Member");
  });

  it("returns 404 for an unknown code", async () => {
    const res = await buildApp().request("/invites/NOPE-NOPE-NOPE");
    expect(res.status).toBe(404);
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

// ─── POST /admin/invites/:id/extend ──────────────────────────────────────────

describe("POST /admin/invites/:id/extend", () => {
  beforeEach(seedBaseData);

  it("updates expiresAt for an active invite", async () => {
    await db.insert(invites).values({
      id: "inv-extend-ok",
      code: "EXTEND-111111-AAAAAA",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(Date.now() + 1_000),
      maxUses: 5,
      uses: 0,
    });

    const newExpiry = Date.now() + 30 * 24 * 60 * 60 * 1000;
    const res = await buildApp().request("/admin/invites/inv-extend-ok/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: newExpiry }),
    });

    expect(res.status).toBe(200);
    const row = await db
      .select({ expiresAt: invites.expiresAt })
      .from(invites)
      .where(eq(invites.id, "inv-extend-ok"))
      .get();
    expect(row?.expiresAt?.getTime()).toBe(newExpiry);
  });

  it("returns 404 for an unknown invite id", async () => {
    const res = await buildApp().request("/admin/invites/does-not-exist/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: FUTURE_EXPIRY }),
    });

    expect(res.status).toBe(404);
  });

  it("returns 400 when the new expiresAt is in the past", async () => {
    await db.insert(invites).values({
      id: "inv-extend-past",
      code: "EXTEND-444444-DDDDDD",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request("/admin/invites/inv-extend-past/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: Date.now() - 1_000 }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.expiry_in_past");
  });

  it("returns 409 and does NOT update a revoked invite", async () => {
    await db.insert(invites).values({
      id: "inv-extend-revoked",
      code: "EXTEND-222222-BBBBBB",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(Date.now() + 1_000),
      maxUses: 5,
      uses: 0,
      revokedAt: new Date(Date.now()),
    });

    const before = await db
      .select({ expiresAt: invites.expiresAt })
      .from(invites)
      .where(eq(invites.id, "inv-extend-revoked"))
      .get();

    const res = await buildApp().request("/admin/invites/inv-extend-revoked/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: FUTURE_EXPIRY }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.revoked");

    // The expiry must be untouched — a revoked invite stays unusable.
    const after = await db
      .select({ expiresAt: invites.expiresAt })
      .from(invites)
      .where(eq(invites.id, "inv-extend-revoked"))
      .get();
    expect(after?.expiresAt?.getTime()).toBe(before?.expiresAt?.getTime());
  });

  it("returns 409 for a fully-exhausted invite", async () => {
    await db.insert(invites).values({
      id: "inv-extend-exhausted",
      code: "EXTEND-333333-CCCCCC",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(Date.now() + 1_000),
      maxUses: 1,
      uses: 1,
    });

    const res = await buildApp().request("/admin/invites/inv-extend-exhausted/extend", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ expiresAt: FUTURE_EXPIRY }),
    });

    expect(res.status).toBe(409);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.exhausted");
  });
});

// ─── DELETE /admin/invites/:id ───────────────────────────────────────────────

describe("DELETE /admin/invites/:id", () => {
  beforeEach(seedBaseData);

  it("soft-revokes the invite and excludes it from the list", async () => {
    await db.insert(invites).values({
      id: "inv-to-revoke",
      code: "DELETE-111111-AAAAAA",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request("/admin/invites/inv-to-revoke", { method: "DELETE" });
    expect(res.status).toBe(200);

    const row = await db
      .select({ revokedAt: invites.revokedAt })
      .from(invites)
      .where(eq(invites.id, "inv-to-revoke"))
      .get();
    expect(row?.revokedAt).not.toBeNull();
  });

  it("returns 404 for an unknown invite id", async () => {
    const res = await buildApp().request("/admin/invites/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });

  it("is idempotent: a second DELETE preserves the original revokedAt", async () => {
    const originalRevokedAt = new Date(Date.now() - 60_000);
    await db.insert(invites).values({
      id: "inv-already-revoked",
      code: "DELETE-222222-BBBBBB",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now()),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
      revokedAt: originalRevokedAt,
    });

    const res = await buildApp().request("/admin/invites/inv-already-revoked", {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    // The audit timestamp must not be overwritten by the second revoke.
    const row = await db
      .select({ revokedAt: invites.revokedAt })
      .from(invites)
      .where(eq(invites.id, "inv-already-revoked"))
      .get();
    expect(row?.revokedAt?.getTime()).toBe(originalRevokedAt.getTime());
  });
});
