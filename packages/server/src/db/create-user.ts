// TEMPORARY: Manual user provisioning for deployed environments.
//
// This exists solely to bootstrap the first admin (or seed ad-hoc users)
// before a proper onboarding / invitation flow lands. It is invoked by
// `.github/workflows/create-user.yml`, which is also marked temporary.
//
// DELETE THIS FILE once onboarding is in place.
//
// Reads user details from env vars (not argv) so passwords don't appear
// in any `ps`-style inspection of the running process:
//   CREATE_USER_EMAIL     — required
//   CREATE_USER_PASSWORD  — required, min 8 chars (enforced by Better Auth)
//   CREATE_USER_ROLE_ID   — required, one of: role_admin | role_member | role_viewer
//   CREATE_USER_NAME      — optional, defaults to the local part of the email
//
// Mirrors the admin endpoint in `api/procedures/users.ts` (signUpEmail +
// userRoles insert) so Better Auth handles password hashing — we never
// touch the raw hash here.

import { consola } from "consola";
import { eq } from "drizzle-orm";
import { auth } from "../auth/config";
import { getDb } from "./client";
import { user } from "./schema/auth";
import { roles, userRoles } from "./schema/roles";

const VALID_ROLE_IDS = ["role_admin", "role_member", "role_viewer"] as const;
type ValidRoleId = (typeof VALID_ROLE_IDS)[number];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    consola.error(`Missing required env var: ${name}`);
    process.exit(1);
  }
  return value;
}

function assertValidRoleId(value: string): asserts value is ValidRoleId {
  if (!(VALID_ROLE_IDS as readonly string[]).includes(value)) {
    consola.error(`Invalid role id "${value}". Expected one of: ${VALID_ROLE_IDS.join(", ")}`);
    process.exit(1);
  }
}

async function createUser(): Promise<void> {
  const email = requireEnv("CREATE_USER_EMAIL");
  const password = requireEnv("CREATE_USER_PASSWORD");
  const roleId = requireEnv("CREATE_USER_ROLE_ID");
  assertValidRoleId(roleId);
  const name = process.env.CREATE_USER_NAME?.trim() || email.split("@")[0] || "User";

  const db = getDb();

  // Confirm the role row exists before we touch the user — migrations
  // seed these rows, so a missing row means the migration step was
  // skipped or pointed at the wrong DB.
  const roleRow = await db.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId)).get();
  if (!roleRow) {
    consola.error(
      `Role "${roleId}" not found in DB. Run migrations (they seed system roles) against this database first.`,
    );
    process.exit(1);
  }

  const existing = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
  if (existing) {
    consola.error(
      `User with email "${email}" already exists (id: ${existing.id}). This script only creates new users; use the admin UI to update an existing one.`,
    );
    process.exit(1);
  }

  const result = await auth.api.signUpEmail({ body: { email, password, name } });
  const newUserId = result.user.id;
  consola.success(`Created user ${email} (id: ${newUserId})`);

  await db.insert(userRoles).values({ userId: newUserId, roleId, assignedAt: Date.now() });
  consola.success(`Assigned role ${roleId} to ${email}`);
}

if (import.meta.main) {
  await createUser();
}
