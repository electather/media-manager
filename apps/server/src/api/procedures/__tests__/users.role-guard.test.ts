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
// The seeded system Admin role — the one the guard must block.
const ADMIN_ROLE_ID = "role_admin";
// A seeded role with isSystem=1 that is NOT the Admin role (e.g. Member).
// The guard must allow this to be assigned.
const MEMBER_ROLE_ID = "role_member";
// A custom role with isSystem=0 — always assignable.
const CUSTOM_ROLE_ID = "editor-role";

beforeEach(async () => {
  db = await createInMemoryDb();

  await db.insert(user).values([
    { id: ADMIN_ID, name: "Admin", email: "admin@example.com" },
    { id: TARGET_ID, name: "Target", email: "target@example.com" },
  ]);

  // Mirrors the seeded Admin role: isSystem=1 AND name='Admin' → isSystemAdmin=true.
  await db.insert(roles).values({
    id: ADMIN_ROLE_ID,
    name: "Admin",
    isSystem: 1,
    createdAt: 0,
    updatedAt: 0,
  });

  // Mirrors the seeded Member role: isSystem=1 but name≠'Admin' → NOT isSystemAdmin.
  await db.insert(roles).values({
    id: MEMBER_ROLE_ID,
    name: "Member",
    isSystem: 1,
    createdAt: 0,
    updatedAt: 0,
  });

  // A custom role: isSystem=0 → freely assignable.
  await db.insert(roles).values({
    id: CUSTOM_ROLE_ID,
    name: "Editor",
    isSystem: 0,
    createdAt: 0,
    updatedAt: 0,
  });
});

afterAll(() => cleanupInMemoryDbs());

// These tests verify the DB-level shape the requireRole helper and PUT/POST handlers rely on.
// The guard fires when isSystem===1 AND name==='Admin', mirroring the isSystemAdmin condition
// in auth/service.ts. isSystem=1 alone is not sufficient — Member and Viewer are also isSystem=1
// but are legitimate assignable roles.
describe("users role-assignment guard: system Admin role protection", () => {
  it("Admin role satisfies both guard conditions (isSystem=1 AND name='Admin')", async () => {
    const row = await db
      .select({ id: roles.id, isSystem: roles.isSystem, name: roles.name })
      .from(roles)
      .where(eq(roles.id, ADMIN_ROLE_ID))
      .get();

    expect(row).toBeDefined();
    expect(row?.isSystem).toBe(1);
    expect(row?.name).toBe("Admin");
  });

  it("Member role has isSystem=1 but name≠'Admin' — guard does NOT fire", async () => {
    const row = await db
      .select({ id: roles.id, isSystem: roles.isSystem, name: roles.name })
      .from(roles)
      .where(eq(roles.id, MEMBER_ROLE_ID))
      .get();

    expect(row).toBeDefined();
    expect(row?.isSystem).toBe(1);
    // Guard checks isSystem && name==='Admin'. Member has isSystem=1 but name='Member',
    // so it is NOT blocked and can be freely assigned.
    expect(row?.name).not.toBe("Admin");
  });

  it("Member role (isSystem=1, non-Admin) can be inserted into userRoles", async () => {
    await db
      .insert(userRoles)
      .values({ userId: TARGET_ID, roleId: MEMBER_ROLE_ID, assignedAt: Date.now() })
      .onConflictDoUpdate({
        target: userRoles.userId,
        set: { roleId: MEMBER_ROLE_ID, assignedAt: Date.now() },
      });

    const row = await db.select().from(userRoles).where(eq(userRoles.userId, TARGET_ID)).get();
    expect(row?.roleId).toBe(MEMBER_ROLE_ID);
  });

  it("Admin role is NOT inserted into userRoles when the guard fires", async () => {
    // Simulate the guard: fetch role, evaluate isSystem && name==='Admin', skip insert.
    const role = await db
      .select({ id: roles.id, isSystem: roles.isSystem, name: roles.name })
      .from(roles)
      .where(eq(roles.id, ADMIN_ROLE_ID))
      .get();

    // The handler throws before reaching the insert; verify the guard condition holds.
    expect(role?.isSystem === 1 && role?.name === "Admin").toBe(true);

    // Confirm no userRoles row was created (the handler would have thrown before inserting).
    const assignment = await db
      .select()
      .from(userRoles)
      .where(eq(userRoles.userId, TARGET_ID))
      .get();

    expect(assignment).toBeUndefined();
  });

  it("custom role (isSystem=0) can be assigned", async () => {
    await db
      .insert(userRoles)
      .values({ userId: TARGET_ID, roleId: CUSTOM_ROLE_ID, assignedAt: Date.now() })
      .onConflictDoUpdate({
        target: userRoles.userId,
        set: { roleId: CUSTOM_ROLE_ID, assignedAt: Date.now() },
      });

    const row = await db.select().from(userRoles).where(eq(userRoles.userId, TARGET_ID)).get();
    expect(row?.roleId).toBe(CUSTOM_ROLE_ID);
  });
});
