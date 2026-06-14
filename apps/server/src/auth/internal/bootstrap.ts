// First-install bootstrap token service. On a fresh install (zero users) the
// server prints a one-time setup token to the console; the operator enters it
// on the public `/bootstrap` page to create the first admin. We store only the
// SHA-256 hash of the token — the plaintext exists solely in the boot log and
// is never persisted or returned over HTTP.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { consola } from "consola";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { appBootstrap } from "../../db/schema/app";
import { account, user } from "../../db/schema/auth";
import { userRoles } from "../../db/schema/auth/roles";
import { AuthError } from "../errors";

// Single-row sentinel id for the `app_bootstrap` table.
const BOOTSTRAP_ROW_ID = "bootstrap";

// The plaintext token is held in memory for the life of the process so repeated
// `ensureBootstrapToken()` calls within one boot re-print the same value without
// issuing a new one. It is never persisted to the DB. After a real process
// restart this is empty, so a fresh token is generated and the stored hash is
// overwritten — only the most recently printed token verifies.
let issuedToken: string | null = null;

/** Returns the SHA-256 hex digest of `token`. */
function sha256Hex(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Test helper: drop the in-memory token so the next ensure call re-issues. */
export function resetBootstrapTokenForTest(): void {
  issuedToken = null;
}

/** Prints the plaintext setup token to the console in a boxed banner. */
function printBanner(token: string): void {
  consola.box(
    [
      "nama first-install setup",
      "",
      "This server has no users yet. Open /bootstrap and enter this",
      "one-time setup token to create the first admin account:",
      "",
      token,
    ].join("\n"),
  );
}

/** Returns `true` when the `user` table has zero rows. */
export async function needsBootstrap(): Promise<boolean> {
  const db = getDb();
  const row = await db.select({ id: user.id }).from(user).limit(1).get();
  return !row;
}

/**
 * While the instance is still in bootstrap state, ensures a setup token exists
 * and prints its plaintext to the console in an unmistakable boxed banner. The
 * banner is re-printed on every boot so the operator can always recover the
 * token (e.g. via `docker logs`). A new token is issued only when none is held
 * in memory and no non-consumed row exists; otherwise the existing token is
 * re-printed and nothing new is written. Does nothing once a user exists.
 */
export async function ensureBootstrapToken(): Promise<void> {
  if (!(await needsBootstrap())) return;

  const db = getDb();

  // Re-print the in-memory token (same process) without re-issuing.
  if (issuedToken) {
    printBanner(issuedToken);
    return;
  }

  const existing = await db
    .select({ consumedAt: appBootstrap.consumedAt })
    .from(appBootstrap)
    .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
    .get();

  // A non-consumed row exists but its plaintext was lost (process restart). We
  // cannot recover the old plaintext, so issue a fresh token and overwrite the
  // stored hash — only the freshly printed token verifies.
  const token = randomBytes(32).toString("base64url");
  const tokenHash = sha256Hex(token);
  const now = Date.now();

  if (existing && existing.consumedAt === null) {
    await db
      .update(appBootstrap)
      .set({ tokenHash, createdAt: now })
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID));
  } else {
    await db
      .insert(appBootstrap)
      .values({ id: BOOTSTRAP_ROW_ID, tokenHash, createdAt: now, consumedAt: null })
      .onConflictDoUpdate({
        target: appBootstrap.id,
        set: { tokenHash, createdAt: now, consumedAt: null },
      });
  }

  issuedToken = token;
  printBanner(token);
}

/**
 * Atomically creates the first admin from a valid setup token. The in-transaction
 * zero-users assertion is the core safety property: even under concurrent
 * requests, exactly one first admin can be created, and the token is required to
 * obtain the admin role. The user + account + role inserts are inlined here (the
 * exact technique from `createUserWithRole`) so the whole claim — assert, verify,
 * create, consume — runs in one transaction.
 */
export async function claimBootstrap(input: {
  token: string;
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  const { token, email, password, name } = input;
  const db = getDb();
  const userId = crypto.randomUUID();
  const accountRowId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const now = new Date();
  const tokenHash = sha256Hex(token);

  return db.transaction(async (tx) => {
    // 1. Assert the user table is empty. If any user exists the server is
    //    already set up — reject so setup cannot be re-run or hijacked.
    //    Concurrency: SQLite is single-writer with snapshot isolation, so if two
    //    claims race past this read, the first to insert takes the write lock and
    //    the second aborts with SQLITE_BUSY_SNAPSHOT when it tries to upgrade —
    //    exactly one admin is created. The `user.email` UNIQUE constraint is a
    //    further backstop against same-email duplicates.
    const existingUser = await tx.select({ id: user.id }).from(user).limit(1).get();
    if (existingUser) {
      throw new AuthError("This server is already set up", "bootstrap.already_completed");
    }

    // 2. Load the token row and constant-time compare the supplied token's hash
    //    against the stored hash. A missing row or any mismatch is rejected and
    //    creates nothing. `timingSafeEqual` requires equal-length buffers; the
    //    hex digest is always 64 chars, so we still gate on the row's presence
    //    and equal length before comparing.
    const tokenRow = await tx
      .select({ tokenHash: appBootstrap.tokenHash })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    const suppliedBuf = Buffer.from(tokenHash, "utf8");
    const storedBuf = tokenRow ? Buffer.from(tokenRow.tokenHash, "utf8") : null;
    if (
      !storedBuf ||
      storedBuf.length !== suppliedBuf.length ||
      !timingSafeEqual(storedBuf, suppliedBuf)
    ) {
      throw new AuthError("Invalid setup token", "bootstrap.invalid_token");
    }

    // 3. Create the first admin (user + account + role_admin) inline.
    await tx.insert(user).values({ id: userId, email, name, emailVerified: false });
    await tx.insert(account).values({
      id: accountRowId,
      accountId: userId,
      providerId: "credential",
      userId,
      password: passwordHash,
      updatedAt: now,
    });
    await tx.insert(userRoles).values({ userId, roleId: "role_admin", assignedAt: now.getTime() });

    // 4. Mark the token consumed within the same transaction.
    await tx
      .update(appBootstrap)
      .set({ consumedAt: now.getTime() })
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID));

    return { userId };
  });
}
