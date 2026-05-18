import { eq } from "drizzle-orm";
import { consola } from "consola";
import { getDb } from "./client";
import { user } from "./schema/auth";
import { roles, rolePermissions, userRoles } from "./schema/roles";
// fallow-allow: phase-2 infra-to-module decoupling
// fallow-ignore-next-line boundary-violation
import { ALL_PERMISSIONS, PERMISSIONS, auth } from "../auth";

/** Built-in roles seeded on first run. Permissions for Admin are enforced in code, not DB. */
const SYSTEM_ROLES = [
  {
    id: "role_admin",
    name: "Admin",
    description: "Full access to all features. Assigned to the first user to register.",
    isSystem: 1,
    permissions: ALL_PERMISSIONS,
  },
  {
    id: "role_member",
    name: "Member",
    description: "Standard role for friends and family. Access to all features except admin tools.",
    isSystem: 1,
    permissions: ALL_PERMISSIONS.filter((p) => !p.startsWith("admin:")),
  },
  {
    id: "role_viewer",
    name: "Viewer",
    description:
      "Read-only browsing access. Can browse and see what's available, but cannot request downloads, submit feedback, or manage connections.",
    isSystem: 1,
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
 * A random password is generated on first run and printed to stdout once.
 */
export async function seedDevUser(): Promise<void> {
  const db = getDb();

  // Check whether the dev user already exists so this stays idempotent.
  const existing = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, "admin@me.com"))
    .get();

  let userId: string;

  if (existing) {
    userId = existing.id;
  } else {
    // Generate a random password so the hardcoded fallback never persists.
    const password = crypto.randomUUID().replace(/-/g, "");
    const result = await auth.api.signUpEmail({
      body: { email: "admin@me.com", password, name: "Admin" },
    });
    userId = result.user.id;
    consola.success(`Dev admin user created: admin@me.com / ${password}`);
  }

  // Assign admin role, no-op if already assigned.
  await db
    .insert(userRoles)
    .values({ userId, roleId: "role_admin", assignedAt: Date.now() })
    .onConflictDoNothing();
}
