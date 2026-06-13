import { afterAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { ALL_PERMISSIONS, PERMISSIONS } from "@nama/shared/auth";

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
import { user } from "../../db/schema/auth";
import { rolePermissions, roles, userRoles } from "../../db/schema/auth/roles";
import { loadUserPermissions } from "../repo";

const USER_ADMIN = "u_admin";
const USER_MEMBER = "u_member";
const USER_VIEWER = "u_viewer";
const USER_NONE = "u_none";

async function seed() {
  await db.insert(user).values([
    { id: USER_ADMIN, name: "Admin User", email: "admin@example.com" },
    { id: USER_MEMBER, name: "Member User", email: "member@example.com" },
    { id: USER_VIEWER, name: "Viewer User", email: "viewer@example.com" },
    { id: USER_NONE, name: "No Role", email: "none@example.com" },
  ]);

  await db.insert(roles).values([
    {
      id: "role_admin",
      name: "Admin",
      isSystem: 1,
      systemSlug: "admin",
      createdAt: 0,
      updatedAt: 0,
    },
    { id: "role_member", name: "Member", isSystem: 1, createdAt: 0, updatedAt: 0 },
    { id: "role_viewer", name: "Viewer", isSystem: 1, createdAt: 0, updatedAt: 0 },
  ]);

  const memberPerms = ALL_PERMISSIONS.filter((p) => !p.startsWith("admin:"));
  await db
    .insert(rolePermissions)
    .values([
      ...memberPerms.map((permission) => ({ roleId: "role_member", permission })),
      { roleId: "role_viewer", permission: PERMISSIONS.MEDIA_DISCOVER },
      { roleId: "role_viewer", permission: PERMISSIONS.MEDIA_DETAILS },
      { roleId: "role_viewer", permission: PERMISSIONS.MEDIA_ACTIVITY },
    ]);

  await db.insert(userRoles).values([
    { userId: USER_ADMIN, roleId: "role_admin", assignedAt: 0 },
    { userId: USER_MEMBER, roleId: "role_member", assignedAt: 0 },
    { userId: USER_VIEWER, roleId: "role_viewer", assignedAt: 0 },
  ]);
}

beforeEach(async () => {
  db = await createInMemoryDb();
  await seed();
});

afterAll(() => cleanupInMemoryDbs());

describe("loadUserPermissions", () => {
  it("returns ALL_PERMISSIONS for the Admin system role", async () => {
    const perms = await loadUserPermissions(USER_ADMIN);
    expect(perms.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  // Regression: previously `isSystem === 1` alone short-circuited to ALL_PERMISSIONS,
  // so Member (isSystem=1) silently received admin:* permissions.
  it("returns only the seeded subset for the Member system role — never admin:*", async () => {
    const perms = await loadUserPermissions(USER_MEMBER);
    expect(perms).not.toContain(PERMISSIONS.ADMIN_SERVER);
    expect(perms).not.toContain(PERMISSIONS.ADMIN_USERS);
    expect(perms).not.toContain(PERMISSIONS.ADMIN_PLUGINS);
    expect(perms.every((p) => !p.startsWith("admin:"))).toBe(true);
    expect(perms).toContain(PERMISSIONS.MEDIA_DISCOVER);
  });

  // Regression: Viewer is also seeded with isSystem=1.
  it("returns only the seeded subset for the Viewer system role", async () => {
    const perms = await loadUserPermissions(USER_VIEWER);
    expect(perms.sort()).toEqual(
      [PERMISSIONS.MEDIA_DISCOVER, PERMISSIONS.MEDIA_DETAILS, PERMISSIONS.MEDIA_ACTIVITY].sort(),
    );
  });

  // The slug, not the display name, identifies the admin role — renaming the
  // role must not revoke the admin bypass.
  it("still returns ALL_PERMISSIONS after the Admin role is renamed", async () => {
    await db.update(roles).set({ name: "Owner" }).where(eq(roles.id, "role_admin"));
    const perms = await loadUserPermissions(USER_ADMIN);
    expect(perms.sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  // Conversely, a role merely named "Admin" without the system slug must not
  // receive the bypass.
  it("does not grant ALL_PERMISSIONS to a role named Admin without the system slug", async () => {
    await db.update(roles).set({ name: "Admin Jr" }).where(eq(roles.id, "role_admin"));
    await db.update(roles).set({ name: "Admin" }).where(eq(roles.id, "role_member"));
    const perms = await loadUserPermissions(USER_MEMBER);
    expect(perms.every((p) => !p.startsWith("admin:"))).toBe(true);
  });

  it("returns an empty list when the user has no role", async () => {
    const perms = await loadUserPermissions(USER_NONE);
    expect(perms).toEqual([]);
  });

  // Regression: an unrecognised permission string in the DB (e.g. left over
  // from an old release) must not leak into the session.
  it("filters out unknown permission strings stored in the DB", async () => {
    await db
      .insert(rolePermissions)
      .values([{ roleId: "role_viewer", permission: "legacy:deprecated-flag" }]);
    const perms = await loadUserPermissions(USER_VIEWER);
    expect(perms).not.toContain("legacy:deprecated-flag");
    expect(perms.sort()).toEqual(
      [PERMISSIONS.MEDIA_DISCOVER, PERMISSIONS.MEDIA_DETAILS, PERMISSIONS.MEDIA_ACTIVITY].sort(),
    );
  });
});
