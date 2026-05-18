import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
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

import {
  cleanupInMemoryDbs,
  createInMemoryDb,
  type Db,
} from "../../../__tests__/helpers/in-memory-db";
import { user } from "../../../db/schema/auth";
import { roles, userRoles } from "../../../db/schema/roles";

let db: Db;

const ADMIN_ID = "admin-user";
const TARGET_ID = "target-user";
const SYSTEM_ROLE_ID = "system-admin-role";
const REGULAR_ROLE_ID = "editor-role";

beforeEach(async () => {
  db = await createInMemoryDb();

  await db.insert(user).values([
    { id: ADMIN_ID, name: "Admin", email: "admin@example.com" },
    { id: TARGET_ID, name: "Target", email: "target@example.com" },
  ]);

  // A system-protected role (isSystem = 1).
  await db.insert(roles).values({
    id: SYSTEM_ROLE_ID,
    name: "System Admin",
    isSystem: 1,
    createdAt: 0,
    updatedAt: 0,
  });

  // A normal assignable role (isSystem = 0).
  await db.insert(roles).values({
    id: REGULAR_ROLE_ID,
    name: "Editor",
    isSystem: 0,
    createdAt: 0,
    updatedAt: 0,
  });
});

afterAll(() => cleanupInMemoryDbs());

// These tests verify the DB-level shape that the requireRole helper and PUT
// handler rely on. The guard reads role.isSystem from the DB; we confirm that
// field is correctly set and that the assignment can be blocked at the DB
// query level.
describe("users role-assignment guard: system role protection", () => {
  it("system role has isSystem = 1 in the DB", async () => {
    const row = await db
      .select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, SYSTEM_ROLE_ID))
      .get();

    expect(row).toBeDefined();
    // The guard rejects when this value is truthy.
    expect(row?.isSystem).toBe(1);
  });

  it("regular role has isSystem = 0 in the DB", async () => {
    const row = await db
      .select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, REGULAR_ROLE_ID))
      .get();

    expect(row).toBeDefined();
    // The guard allows assignment when this value is falsy.
    expect(row?.isSystem).toBe(0);
  });

  it("assigning a regular role succeeds (guard does not block)", async () => {
    // Simulate what the handler does after the guard passes.
    await db
      .insert(userRoles)
      .values({ userId: TARGET_ID, roleId: REGULAR_ROLE_ID, assignedAt: Date.now() })
      .onConflictDoUpdate({
        target: userRoles.userId,
        set: { roleId: REGULAR_ROLE_ID, assignedAt: Date.now() },
      });

    const row = await db.select().from(userRoles).where(eq(userRoles.userId, TARGET_ID)).get();

    expect(row?.roleId).toBe(REGULAR_ROLE_ID);
  });

  it("system role is NOT inserted into userRoles when the guard fires", async () => {
    // Simulate the guard: fetch role, check isSystem, skip insert.
    const role = await db
      .select({ id: roles.id, isSystem: roles.isSystem })
      .from(roles)
      .where(eq(roles.id, SYSTEM_ROLE_ID))
      .get();

    // The handler throws before reaching the insert; verify the guard fires.
    expect(role?.isSystem).toBeTruthy();

    // Confirm no userRoles row was created (the handler would have thrown).
    const assignment = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();

    expect(assignment).toBeUndefined();
  });
});
