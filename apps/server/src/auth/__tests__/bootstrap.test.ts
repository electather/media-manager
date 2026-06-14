import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { ALL_PERMISSIONS } from "@nama/shared/auth";

vi.mock("../../env", () => ({
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

vi.mock("../../db/client", () => ({
  getDb: () => db,
}));

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../__tests__/helpers/in-memory-db";
import { account, user } from "../../db/schema/auth";
import { appBootstrap } from "../../db/schema/app";
import { roles, userRoles } from "../../db/schema/auth/roles";
import { loadUserPermissions } from "../repo";
import {
  claimBootstrap,
  ensureBootstrapToken,
  needsBootstrap,
  resetBootstrapTokenForTest,
} from "../internal/bootstrap";
import { AuthError } from "../errors";

const BOOTSTRAP_ROW_ID = "bootstrap";

/** Returns the SHA-256 hex digest the service stores, so tests can seed a row
 *  whose plaintext token they know without spying on the console banner. */
function sha256Hex(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Seeds the built-in Admin role so `claimBootstrap` can assign `role_admin`
 *  and `loadUserPermissions` can resolve the admin slug to ALL_PERMISSIONS. */
async function seedAdminRole(): Promise<void> {
  await db.insert(roles).values({
    id: "role_admin",
    name: "Admin",
    isSystem: 1,
    systemSlug: "admin",
    createdAt: 0,
    updatedAt: 0,
  });
}

/** Inserts an active (non-consumed) token row whose plaintext is `token`. The
 *  service never returns the plaintext, so seeding the known hash directly is
 *  the cleanest way to later claim with that exact token. */
async function seedTokenRow(token: string): Promise<void> {
  await db.insert(appBootstrap).values({
    id: BOOTSTRAP_ROW_ID,
    tokenHash: sha256Hex(token),
    createdAt: Date.now(),
    consumedAt: null,
  });
}

beforeEach(async () => {
  db = await createInMemoryDb();
  // The in-memory token survives between tests in the same process; reset it so
  // each `ensureBootstrapToken` test starts from a clean issue state.
  resetBootstrapTokenForTest();
});

afterAll(() => cleanupInMemoryDbs());

describe("needsBootstrap", () => {
  // Bootstrap is the only sanctioned first-admin path; it must open exactly when
  // the install is fresh (zero users) and close the instant a user exists.
  it("is true with zero users", async () => {
    expect(await needsBootstrap()).toBe(true);
  });

  it("is false after a user exists", async () => {
    await db.insert(user).values({ id: "u1", name: "Someone", email: "s@example.com" });
    expect(await needsBootstrap()).toBe(false);
  });
});

describe("ensureBootstrapToken", () => {
  // The plaintext token must never touch the DB — only its hash. A leaked hash
  // cannot be replayed as a token, so storing only the digest is load-bearing.
  it("issues exactly one active row storing only a 64-char hex hash, not the plaintext", async () => {
    await ensureBootstrapToken();

    const rows = await db.select().from(appBootstrap).all();
    expect(rows).toHaveLength(1);
    const row = await db
      .select()
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    expect(row?.consumedAt).toBeNull();
    // SHA-256 hex is always 64 lowercase hex chars; assert that shape rather
    // than a specific value, since the service never returns the plaintext.
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Re-running boot while a non-consumed token already exists must not mint a
  // second token — otherwise every restart would invalidate the operator's
  // copy and there could be ambiguity about which token is valid.
  it("does not issue a new token while a non-consumed row exists in the same process", async () => {
    await ensureBootstrapToken();
    const first = await db
      .select({ tokenHash: appBootstrap.tokenHash })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();

    await ensureBootstrapToken();
    const rows = await db.select().from(appBootstrap).all();
    expect(rows).toHaveLength(1);
    const second = await db
      .select({ tokenHash: appBootstrap.tokenHash })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    // Same in-memory token re-printed, so the stored hash is unchanged.
    expect(second?.tokenHash).toBe(first?.tokenHash);
  });

  // After a real process restart the in-memory plaintext is gone, but a
  // non-consumed token row may still be on disk. Because only the hash is
  // stored, the old plaintext is unrecoverable, so the service mints a FRESH
  // token and overwrites the stored hash — the previously printed token stops
  // working and only the newly printed one verifies. This resolves the design's
  // "recover the token from the boot log" goal against hash-only storage: the
  // operator always gets a working token from the logs on every boot, just not
  // the same one across restarts.
  it("issues a fresh token (overwriting the stored hash) on a restart with a stale non-consumed row", async () => {
    const stale = "token-from-a-previous-process";
    await seedTokenRow(stale);
    const staleHash = sha256Hex(stale);

    // beforeEach already cleared the in-memory token, simulating a new process
    // where the previously printed plaintext was lost.
    await ensureBootstrapToken();

    const rows = await db.select().from(appBootstrap).all();
    expect(rows).toHaveLength(1);
    const row = await db
      .select()
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    expect(row?.consumedAt).toBeNull();
    // A new token was minted, so the stored hash no longer matches the stale one.
    expect(row?.tokenHash).not.toBe(staleHash);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  // Once a user exists the instance is set up; issuing or re-printing a token
  // would be a setup-reopening hazard, so the service must do nothing.
  it("does nothing once a user exists", async () => {
    await db.insert(user).values({ id: "u1", name: "Someone", email: "s@example.com" });
    await ensureBootstrapToken();
    const rows = await db.select().from(appBootstrap).all();
    expect(rows).toHaveLength(0);
  });
});

describe("claimBootstrap", () => {
  // The happy path: a valid token creates the first admin (user + credential
  // account + role_admin), consumes the token, and the new admin resolves the
  // full permission set — proving the role was actually wired, not just a row.
  it("creates user + account + role_admin, consumes the token, and the admin resolves ALL_PERMISSIONS", async () => {
    await seedAdminRole();
    const token = "known-valid-setup-token";
    await seedTokenRow(token);

    const { userId } = await claimBootstrap({
      token,
      email: "admin@example.com",
      password: "password123",
      name: "Admin",
    });

    const userRow = await db.select().from(user).where(eq(user.id, userId)).get();
    expect(userRow?.email).toBe("admin@example.com");
    // The operator proved control of the server by reading the console token, so
    // the bootstrap admin is created already email-verified.
    expect(userRow?.emailVerified).toBe(true);

    const accountRow = await db.select().from(account).where(eq(account.userId, userId)).get();
    // Mirrors what Better Auth's sign-up/email writes, so sign-in/email can later
    // look up and verify the credential.
    expect(accountRow?.providerId).toBe("credential");
    expect(accountRow?.password).toBeTruthy();
    // The stored password must be a hash, never the plaintext.
    expect(accountRow?.password).not.toBe("password123");

    const roleRow = await db.select().from(userRoles).where(eq(userRoles.userId, userId)).get();
    expect(roleRow?.roleId).toBe("role_admin");

    const consumed = await db
      .select({ consumedAt: appBootstrap.consumedAt })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    expect(consumed?.consumedAt).not.toBeNull();

    const perms = await loadUserPermissions(userId);
    expect(perms.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  // The in-transaction zero-users assertion is the core safety property: setup
  // cannot be re-run or hijacked once any account exists, even with a valid
  // token. Nothing new may be created.
  it("rejects with already_completed once any user exists and creates nothing", async () => {
    await seedAdminRole();
    const token = "known-valid-setup-token";
    await seedTokenRow(token);
    await db.insert(user).values({ id: "pre", name: "Pre", email: "pre@example.com" });

    await expect(
      claimBootstrap({ token, email: "admin@example.com", password: "password123", name: "Admin" }),
    ).rejects.toMatchObject({ code: "bootstrap.already_completed" });

    // Only the pre-existing user remains; no admin user, account, or role added.
    expect(await db.select().from(user).all()).toHaveLength(1);
    expect(await db.select().from(account).all()).toHaveLength(0);
    expect(await db.select().from(userRoles).all()).toHaveLength(0);
  });

  // The token must actually gate admin creation: a wrong token creates nothing,
  // proving the hash comparison is enforced rather than cosmetic.
  it("rejects a wrong token with invalid_token and creates nothing", async () => {
    await seedAdminRole();
    await seedTokenRow("the-real-token");

    await expect(
      claimBootstrap({
        token: "not-the-real-token",
        email: "admin@example.com",
        password: "password123",
        name: "Admin",
      }),
    ).rejects.toMatchObject({ code: "bootstrap.invalid_token" });

    expect(await db.select().from(user).all()).toHaveLength(0);
    expect(await db.select().from(account).all()).toHaveLength(0);
    expect(await db.select().from(userRoles).all()).toHaveLength(0);
    // The token row stays unconsumed so the operator can retry with the real one.
    const row = await db
      .select({ consumedAt: appBootstrap.consumedAt })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    expect(row?.consumedAt).toBeNull();
  });

  // Defense-in-depth: an already-consumed token must be rejected even if its
  // hash matches. The zero-users assertion is the primary guard, but if every
  // user row were ever deleted, replaying a spent token from the boot log must
  // not mint a second admin. Requiring `consumedAt === null` closes that gap.
  it("rejects a consumed token with invalid_token even when no user exists", async () => {
    await seedAdminRole();
    const token = "known-valid-setup-token";
    await db.insert(appBootstrap).values({
      id: BOOTSTRAP_ROW_ID,
      tokenHash: sha256Hex(token),
      createdAt: Date.now(),
      // The token was already spent by a prior claim; the user it created has
      // since been removed, so the zero-users guard alone would let it through.
      consumedAt: Date.now(),
    });

    await expect(
      claimBootstrap({ token, email: "admin@example.com", password: "password123", name: "Admin" }),
    ).rejects.toMatchObject({ code: "bootstrap.invalid_token" });

    expect(await db.select().from(user).all()).toHaveLength(0);
    expect(await db.select().from(account).all()).toHaveLength(0);
    expect(await db.select().from(userRoles).all()).toHaveLength(0);
  });

  // A missing token row (no boot ever issued one) must also be rejected, not
  // crash — there is nothing to compare against, so the claim is invalid.
  it("rejects with invalid_token when no token row exists and creates nothing", async () => {
    await seedAdminRole();

    await expect(
      claimBootstrap({
        token: "anything",
        email: "a@example.com",
        password: "password123",
        name: "A",
      }),
    ).rejects.toBeInstanceOf(AuthError);
    expect(await db.select().from(user).all()).toHaveLength(0);
  });
});
