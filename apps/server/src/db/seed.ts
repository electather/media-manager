import { eq } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "./client";
import { user } from "./schema/auth";
import { roles, rolePermissions } from "./schema/auth/roles";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { ALL_PERMISSIONS, PERMISSIONS, SYSTEM_ADMIN_ROLE_SLUG, createUserWithRole } from "../auth";

/** Built-in roles seeded on first run. Permissions for Admin are enforced in code, not DB. */
const SYSTEM_ROLES = [
  {
    id: "role_admin",
    name: "Admin",
    description: "Full access to all features. Assigned to the first user to register.",
    isSystem: 1,
    systemSlug: SYSTEM_ADMIN_ROLE_SLUG,
    permissions: ALL_PERMISSIONS,
  },
  {
    id: "role_member",
    name: "Member",
    description: "Standard role for friends and family. Access to all features except admin tools.",
    isSystem: 1,
    systemSlug: null,
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("admin:")),
  },
  {
    id: "role_viewer",
    name: "Viewer",
    description:
      "Read-only browsing access. Can browse and see what's available, but cannot request downloads, submit feedback, or manage connections.",
    isSystem: 1,
    systemSlug: null,
    permissions: [
      PERMISSIONS.MEDIA_DISCOVER,
      PERMISSIONS.MEDIA_DETAILS,
      PERMISSIONS.MEDIA_ACTIVITY,
    ],
  },
] as const;

/** Seeds the default system roles and their permissions. Safe to call on every startup — idempotent. */
export async function seedRoles(): Promise<void> {
  const db = getDb();
  const now = Date.now();

  for (const role of SYSTEM_ROLES) {
    await db
      .insert(roles)
      .values({
        id: role.id,
        name: role.name,
        description: role.description,
        isSystem: role.isSystem,
        systemSlug: role.systemSlug,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing();

    for (const permission of role.permissions) {
      await db
        .insert(rolePermissions)
        .values({ roleId: role.id, permission })
        .onConflictDoNothing();
    }
  }

  consola.success("Roles seeded.");
}

/**
 * Seeds a local admin user for development. Never called in production.
 * Credentials: admin@me.com / password123
 */
export async function seedDevUser(): Promise<void> {
  // Self-contained guard so any direct caller can never seed the well-known
  // dev credentials outside development, even if it bypasses migrate.ts.
  if (process.env.NODE_ENV !== "development") return;

  const db = getDb();

  // Check whether the dev user already exists so this stays idempotent.
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, "admin@me.com"))
    .get();

  if (existing) return;

  // createUserWithRole assigns role_admin inside the same transaction, so no
  // separate role upsert is needed.
  await createUserWithRole({
    email: "admin@me.com",
    password: "password123",
    name: "Admin",
    roleId: "role_admin",
  });
  consola.success("Dev admin user created: admin@me.com / password123");
}
