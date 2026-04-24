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
//   CREATE_USER_PASSWORD  — required, min 8 chars
//   CREATE_USER_ROLE_ID   — required, one of: role_admin | role_member | role_viewer
//   CREATE_USER_NAME      — optional, defaults to the local part of the email
//
// Writes `user` + `account` rows directly via drizzle instead of calling
// `auth.api.signUpEmail()`. Booting better-auth here would load the `jwt`
// plugin, which lazily generates a JWKS keypair and encrypts its private
// key with whatever `BETTER_AUTH_SECRET` this script happened to run
// with. That row then lives in the same DB the Worker reads from, so if
// the two secrets disagree the Worker fails at startup with "Failed to
// decrypt private key". The account row written below mirrors the shape
// better-auth itself writes from `sign-up/email`: `providerId = "credential"`,
// `accountId = userId`, `password = <argon2id hash>`. That is exactly
// what `sign-in/email` looks up at login time.

import { consola } from "consola";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password";
import { getDb } from "./client";
import { account, user } from "./schema/auth";
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
  // Better-auth enforces this at the sign-up route; we're bypassing that
  // route so enforce it here.
  if (password.length < 8) {
    consola.error("CREATE_USER_PASSWORD must be at least 8 characters.");
    process.exit(1);
  }
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

  const userId = crypto.randomUUID();
  const accountRowId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();

  // Single transaction so we can't leave an orphaned user row behind if
  // the account or role insert fails. `account.updated_at` has no SQL
  // default (unlike `user.updated_at`), so we pass it explicitly.
  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id: userId,
      email,
      name,
      emailVerified: false,
    });
    await tx.insert(account).values({
      id: accountRowId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      updatedAt: now,
    });
    await tx.insert(userRoles).values({ userId, roleId, assignedAt: now.getTime() });
  });

  consola.success(`Created user ${email} (id: ${userId}) with role ${roleId}`);
}

if (import.meta.main) {
  await createUser();
}
