/** Tests for invite admin routes and accept. In-memory SQLite + mocked auth (mirrors users.role-guard.test.ts).
 *  Accept tests verify the atomic use-count guard and duplicate-email rollback. */
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 0,
      revokedAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // Orphan the invite: drop the role with FK enforcement off, then restore it.
    // try/finally ensures FK enforcement is always re-enabled even if the delete
    // throws — otherwise subsequent tests in this file would run with FKs off.
    // Safe across tests because beforeEach (line 117) recreates db fresh each time,
    // so MEMBER_ROLE_ID is always re-inserted by seedBaseData on a clean slate.
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
      createdAt: new Date(),
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
        createdAt: new Date(),
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
      createdAt: new Date(),
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

  // Preview 410 paths — the link is no longer usable. The accepter should not
  // see an accept form; instead the UI can surface a meaningful error message.
  it("returns 410 with invites.gone for an expired invite", async () => {
    const code = "PRVEXP-BBBBBB-222222";
    await db.insert(invites).values({
      id: "inv-preview-expired",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() - 1_000), // already expired
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.gone");
  });

  it("returns 410 with invites.gone for an exhausted invite (uses >= maxUses)", async () => {
    const code = "PRVEXH-CCCCCC-333333";
    await db.insert(invites).values({
      id: "inv-preview-exhausted",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 1, // already exhausted
    });

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.gone");
  });

  it("returns 410 with invites.gone for a revoked invite", async () => {
    const code = "PRVRVK-DDDDDD-444444";
    await db.insert(invites).values({
      id: "inv-preview-revoked",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
      revokedAt: new Date(),
    });

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.gone");
  });

  // An orphaned invite — the referenced role was deleted after minting — must
  // surface as 410 (not a blank role name). This mirrors the accept path's L1b
  // guard: both preview and accept must agree on the "gone" state so the UI
  // shows the same error and accept never attempts to assign a ghost role.
  it("returns 410 with invites.gone when the bound role was deleted (orphaned invite)", async () => {
    const code = "PRVOPH-EEEEEE-555555";
    await db.insert(invites).values({
      id: "inv-preview-orphan",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    // Drop the role with FK enforcement off to create the orphaned state.
    // The try/finally ensures FK enforcement is always re-enabled.
    await db.run(sql`PRAGMA foreign_keys=OFF`);
    try {
      await db.delete(roles).where(eq(roles.id, MEMBER_ROLE_ID));
    } finally {
      await db.run(sql`PRAGMA foreign_keys=ON`);
    }

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.gone");
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
        createdAt: new Date(),
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
        createdAt: new Date(),
        expiresAt: new Date(FUTURE_EXPIRY),
        maxUses: 5,
        uses: 0,
        revokedAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 1_000),
      maxUses: 5,
      uses: 0,
      revokedAt: new Date(),
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
      createdAt: new Date(),
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

// ─── POST /admin/invites — create with expiresAt in the past ─────────────────

describe("POST /admin/invites — expiresAt in the past", () => {
  beforeEach(seedBaseData);

  // The guard prevents the server from creating an immediately-unusable invite.
  // Without it, an admin could mint a link that rejects every accept attempt.
  it("returns 400 with invites.expiry_in_past when expiresAt <= now", async () => {
    const res = await buildApp().request("/admin/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roleId: MEMBER_ROLE_ID,
        expiresAt: Date.now() - 1_000,
        maxUses: 1,
      }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.expiry_in_past");
  });
});

// ─── POST /admin/invites — code-collision retry loop ─────────────────────────

// The mock at line 27 wires `getDb` as a closure: `getDb: () => db`. Every
// handler call to `getDb()` returns the *current* value of the module-level
// `db` variable, so reassigning `db` here redirects the procedure's DB access
// to the proxy for the duration of the test.
function withFailingInsert<T>(error: Error, fn: () => Promise<T>): Promise<T> {
  const originalDb = db;
  const failingInsert = () => ({ values: () => Promise.reject(error) }); // assumes bare .values() — no .returning()
  db = new Proxy(originalDb, {
    get(target, prop) {
      if (prop === "insert") return failingInsert;
      const value = (target as any)[prop];
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as typeof db;
  return fn().finally(() => {
    db = originalDb;
  });
}

describe("POST /admin/invites — code-collision retry loop", () => {
  beforeEach(seedBaseData);

  // When all three retry attempts fail with a code-collision UNIQUE error the
  // handler must give up and return 500 / invites.code_collision. In practice
  // the loop should never exhaust (90-bit entropy), but the guard must not
  // silently swallow the final error.
  it("returns 500 with invites.code_collision when all retries fail on collision", async () => {
    const collisionError = new Error("UNIQUE constraint failed: invites.code");
    const res = await withFailingInsert(collisionError, async () =>
      buildApp().request("/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: MEMBER_ROLE_ID,
          expiresAt: FUTURE_EXPIRY,
          maxUses: 1,
        }),
      }),
    );

    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.code_collision");
  });

  // A non-collision DB error (e.g. disk full, schema mismatch) must be rethrown
  // unchanged — the retry loop must not silently eat unrelated failures and
  // mask them behind the generic code_collision 500.
  it("rethrows non-collision insert errors unchanged", async () => {
    const otherError = new Error("disk I/O error");
    const res = await withFailingInsert(otherError, async () =>
      buildApp().request("/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roleId: MEMBER_ROLE_ID,
          expiresAt: FUTURE_EXPIRY,
          maxUses: 1,
        }),
      }),
    );

    // The unmasked error surfaces as a generic 500, not code_collision.
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code?: string; message?: string };
    expect(body.code).not.toBe("invites.code_collision");
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
      createdAt: new Date(),
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
      createdAt: new Date(),
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

// ─── maxUses = 0 (unlimited) branch ──────────────────────────────────────────

// maxUses=0 means unlimited: `uses < maxUses` is never the exhaustion condition.
// This branch is load-bearing in the accept guard, preview, and list — a bug
// here would silently cap an admin-intended unlimited invite after the first use.
describe("POST /invites/:code/accept — maxUses=0 unlimited invite", () => {
  it("allows more than one accept and correctly increments uses each time", async () => {
    await seedBaseData();

    const code = "UNLIM0-AAAAAA-111111";
    await db.insert(invites).values({
      id: "inv-unlimited",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 0, // unlimited
      uses: 0,
    });

    const first = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Alice",
        email: "alice@example.com",
        password: "password-longer-12",
      }),
    });
    expect(first.status).toBe(200);

    const afterFirst = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-unlimited"))
      .get();
    expect(afterFirst?.uses).toBe(1);

    const second = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Bob",
        email: "bob@example.com",
        password: "password-longer-12",
      }),
    });
    // A maxUses=0 invite must not be rejected after the first acceptance.
    expect(second.status).toBe(200);

    const afterSecond = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-unlimited"))
      .get();
    expect(afterSecond?.uses).toBe(2);
  });
});

describe("GET /invites/:code — maxUses=0 unlimited invite is never flagged as gone", () => {
  beforeEach(seedBaseData);

  // A maxUses=0 invite with uses>0 must still preview as 200: `expired` is false
  // when maxUses=0 regardless of how many people have already accepted.
  it("returns 200 for a maxUses=0 invite that already has uses>0", async () => {
    const code = "UNLIM0-BBBBBB-222222";
    await db.insert(invites).values({
      id: "inv-unlimited-used",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 0, // unlimited
      uses: 99, // already accepted many times
    });

    const res = await buildApp().request(`/invites/${code}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { roleName: string };
    expect(body.roleName).toBe("Member");
  });
});

describe("GET /admin/invites — maxUses=0 invite is not flagged expired", () => {
  it("reports expired=false for a maxUses=0 invite with uses>0", async () => {
    await seedBaseData();

    await db.insert(invites).values({
      id: "inv-unlimited-list",
      code: "UNLIM0-CCCCCC-333333",
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 0, // unlimited
      uses: 10,
    });

    const res = await buildApp().request("/admin/invites");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { invites: { id: string; expired: boolean }[] };
    const row = body.invites.find((i) => i.id === "inv-unlimited-list");
    expect(row).toBeDefined();
    // An unlimited invite with high use count must not be reported as expired.
    expect(row?.expired).toBe(false);
  });
});

// ─── Accept — unknown code returns 410, not 404 or 500 ───────────────────────

// The accept route collapses "unknown code" and "exhausted/revoked" into the
// same 410 response. This is intentional: leaking a distinct 404 for unknown
// codes would let an attacker confirm which invite codes exist by probing. The
// test documents this design choice so a refactor cannot silently change it.
describe("POST /invites/:code/accept — unknown code returns 410", () => {
  it("returns 410 (not 404 or 500) for a code that has never existed", async () => {
    await seedBaseData();

    const res = await buildApp().request("/invites/NOCODE-ZZZZZZ-ZZZZZZ/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });

    expect(res.status).toBe(410);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invites.gone");
  });
});

// ─── Accept 410 paths — uses must remain untouched on rejection ──────────────

// The accept guard's atomic UPDATE runs inside a transaction that rolls back on
// any error. For the cases where the UPDATE itself matches 0 rows (expired /
// exhausted / revoked) the transaction never increments, so uses must be
// unchanged. This strengthens the existing 410 tests with an explicit DB check.
describe("POST /invites/:code/accept — 410 paths do not increment uses", () => {
  beforeEach(seedBaseData);

  it("does not increment uses when accepting an expired invite", async () => {
    const code = "410USR-AAAAAA-XXXXXX";
    await db.insert(invites).values({
      id: "inv-410-expired",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(Date.now() - 10_000),
      expiresAt: new Date(Date.now() - 1_000),
      maxUses: 5,
      uses: 0,
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });
    expect(res.status).toBe(410);

    // The failed accept must not have burned a use — uses stays at 0.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-410-expired"))
      .get();
    expect(inv?.uses).toBe(0);
  });

  it("does not increment uses when accepting an exhausted invite", async () => {
    const code = "410USR-BBBBBB-YYYYYY";
    await db.insert(invites).values({
      id: "inv-410-exhausted",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 1, // exhausted
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });
    expect(res.status).toBe(410);

    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-410-exhausted"))
      .get();
    // Uses must not exceed the cap — the guard rolled back.
    expect(inv?.uses).toBe(1);
  });

  it("does not increment uses when accepting a revoked invite", async () => {
    const code = "410USR-CCCCCC-ZZZZZZ";
    await db.insert(invites).values({
      id: "inv-410-revoked",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
      revokedAt: new Date(),
    });

    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@example.com", password: "password-longer-12" }),
    });
    expect(res.status).toBe(410);

    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-410-revoked"))
      .get();
    expect(inv?.uses).toBe(0);
  });
});

// ─── Sequential double-accept — uses must stop at the cap ────────────────────

// The existing sequential double-accept test confirms the second request 410s,
// but does not verify that uses stayed at 1 (the cap). Without this assertion,
// a bug that incremented uses on both calls while still returning 410 on the
// second would be invisible.
describe("POST /invites/:code/accept — maxUses=1 uses stops at cap", () => {
  it("uses is exactly 1 after first success and second 410", async () => {
    await seedBaseData();

    const code = "CAPCHK-444444-EEEEEE";
    await db.insert(invites).values({
      id: "inv-cap-check",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 1,
      uses: 0,
    });

    const first = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "First",
        email: "capchk1@example.com",
        password: "password-longer-12",
      }),
    });
    expect(first.status).toBe(200);

    const second = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Second",
        email: "capchk2@example.com",
        password: "password-longer-12",
      }),
    });
    expect(second.status).toBe(410);

    // The use count must have stopped at the cap of 1 — the second attempt
    // must not have incremented it past the maxUses boundary.
    const inv = await db
      .select({ uses: invites.uses })
      .from(invites)
      .where(eq(invites.id, "inv-cap-check"))
      .get();
    expect(inv?.uses).toBe(1);
  });
});

// ─── Happy path — password is hashed, not stored as plaintext ────────────────

// The accept path calls hashPassword (scrypt) before inserting the credential
// row. Verifying the hash is non-empty and differs from the plaintext ensures
// the call was not accidentally short-circuited (e.g. returning the raw string
// from a stub or skipping hashing entirely).
describe("POST /invites/:code/accept — password is hashed in the credential row", () => {
  it("stores a non-empty hash that differs from the original plaintext password", async () => {
    await seedBaseData();

    const code = "HASHCK-AAAAAA-111111";
    await db.insert(invites).values({
      id: "inv-hash-check",
      code,
      roleId: MEMBER_ROLE_ID,
      invitedBy: ACTING_ADMIN_ID,
      createdAt: new Date(),
      expiresAt: new Date(FUTURE_EXPIRY),
      maxUses: 5,
      uses: 0,
    });

    const plaintext = "password-longer-than-12";
    const res = await buildApp().request(`/invites/${code}/accept`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Hashed", email: "hashcheck@example.com", password: plaintext }),
    });
    expect(res.status).toBe(200);

    const createdUser = await db
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, "hashcheck@example.com"))
      .get();
    expect(createdUser).not.toBeNull();

    const credAccount = await db
      .select({ password: account.password })
      .from(account)
      .where(eq(account.userId, createdUser!.id))
      .get();

    // The stored password must be non-empty (hashing did not return nothing).
    expect(credAccount?.password).toBeTruthy();
    // The stored value must not equal the plaintext (hashing was not skipped).
    expect(credAccount?.password).not.toBe(plaintext);
  });
});

// ─── Rate-limit wiring — accept and preview use distinct buckets ──────────────

// acceptIpRateLimit (capacity 5) vs publicIpRateLimit (capacity 60) — accept must stay tighter
// to prevent scrypt CPU exposure. Module mocks shim both so other tests don't trip limits.
// This test loads the *real* modules via vi.importActual to verify the structural invariant.
// Role-guard note: auth mock at lines 50-53 must stay in sync with roleHasAdminTierPermission
// in auth/index.ts — users.role-guard.test.ts follows the same pattern.
describe("rate-limit wiring — accept and preview use distinct buckets", () => {
  it("acceptIpLimiter has capacity 5 and publicIpLimiter has capacity 60", async () => {
    // Load the REAL module (not the vi.mock shim) to inspect the limiter instances.
    const actual =
      await vi.importActual<typeof import("../../../api/rate-limit")>("../../../api/rate-limit");
    const { acceptIpLimiter, publicIpLimiter } = actual;

    // Drain tokens to measure capacity: start fresh, then consume until the
    // bucket rejects. The key is arbitrary (these are not keyed by session).
    acceptIpLimiter.reset();
    publicIpLimiter.reset();

    let acceptCapacity = 0;
    while (acceptIpLimiter.check("test-ip", 1) === null) {
      acceptCapacity++;
      if (acceptCapacity > 20) break; // safety valve — fail loudly if capacity is wildly misconfigured
    }

    let publicCapacity = 0;
    while (publicIpLimiter.check("test-ip", 1) === null) {
      publicCapacity++;
      if (publicCapacity > 200) break; // safety valve — generous for the larger public bucket
    }

    // Accept bucket must be the tighter one to protect scrypt CPU.
    expect(acceptCapacity).toBe(5);
    // Preview bucket must be the generous shared-reads bucket.
    expect(publicCapacity).toBe(60);

    // Verify they are not the same object — a single shared bucket would
    // mean a preview burst could drain the accept allowance.
    expect(acceptIpLimiter).not.toBe(publicIpLimiter);

    // Clean up so subsequent tests are not affected.
    acceptIpLimiter.reset();
    publicIpLimiter.reset();
  });
});
