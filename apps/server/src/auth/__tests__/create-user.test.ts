import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";

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
import { roles, userRoles } from "../../db/schema/auth/roles";
import { createUser, createUserWithRole } from "../internal/create-user";

async function seedMemberRole(): Promise<void> {
  await db.insert(roles).values({
    id: "role_member",
    name: "Member",
    isSystem: 1,
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(async () => {
  db = await createInMemoryDb();
});

afterAll(() => cleanupInMemoryDbs());

// `POST /api/admin/users` now routes through these helpers instead of
// `auth.api.signUpEmail` (which `disableSignUp` blocks). These tests are the
// regression guard that admin-driven user creation still writes the same rows
// the endpoint promised.
describe("createUserWithRole", () => {
  // The endpoint's role-assigning path must produce a usable credential account
  // plus exactly one role assignment — the single-role-per-user invariant.
  it("creates user + credential account + a single user_roles row for a member role", async () => {
    await seedMemberRole();

    const { userId } = await createUserWithRole({
      email: "member@example.com",
      password: "password-12345",
      name: "Member",
      roleId: "role_member",
    });

    const userRow = await db.select().from(user).where(eq(user.id, userId)).get();
    expect(userRow?.email).toBe("member@example.com");

    const accountRow = await db.select().from(account).where(eq(account.userId, userId)).get();
    expect(accountRow?.providerId).toBe("credential");
    // A hash is stored so sign-in/email can verify it; never the plaintext.
    expect(accountRow?.password).toBeTruthy();
    expect(accountRow?.password).not.toBe("password-12345");

    const roleRows = await db.select().from(userRoles).where(eq(userRoles.userId, userId)).all();
    expect(roleRows).toHaveLength(1);
    const roleRow = await db.select().from(userRoles).where(eq(userRoles.userId, userId)).get();
    expect(roleRow?.roleId).toBe("role_member");
  });
});

describe("createUser", () => {
  // The endpoint's no-role path must create the user + account but assign NO
  // role — the admin endpoint allows omitting `roleId`, and a role-less user is
  // a deliberate state the helper must preserve.
  it("creates user + account and NO user_roles row", async () => {
    const { userId } = await createUser({
      email: "norole@example.com",
      password: "password-12345",
      name: "No Role",
    });

    const userRow = await db.select().from(user).where(eq(user.id, userId)).get();
    expect(userRow?.email).toBe("norole@example.com");

    const accountRow = await db.select().from(account).where(eq(account.userId, userId)).get();
    expect(accountRow?.providerId).toBe("credential");

    const roleRows = await db.select().from(userRoles).where(eq(userRoles.userId, userId)).all();
    expect(roleRows).toHaveLength(0);
  });
});
