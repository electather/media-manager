// First-install bootstrap token service. On a fresh install (zero users) the
// server prints a one-time setup token to the console; the operator enters it
// on the public `/bootstrap` page to create the first admin. We store only the
// SHA-256 hash of the token — the plaintext exists solely in the boot log and
// is never persisted or returned over HTTP.

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { consola } from "consola";
import { eq } from "drizzle-orm";
import { getDb } from "../../db/client";
import { appBootstrap } from "../../db/schema/app";
import { user } from "../../db/schema/auth";
import { AuthError } from "../errors";
import { insertCredentialUserTx } from "./create-user";

// Single-row sentinel id for the `app_bootstrap` table.
const BOOTSTRAP_ROW_ID = "bootstrap";

// The plaintext token is held in memory for the life of the process so repeated
// `ensureBootstrapToken()` calls within one boot re-print the same value without
// issuing a new one. It is never persisted to the DB. After a real process
// restart this is empty, so a fresh token is generated and the stored hash is
// overwritten — only the most recently printed token verifies.
//
// This is per-process state. In a clustered/multi-process deployment each worker
// holds its own `issuedToken` and could print a different one on the same boot;
// only the last hash written to the DB verifies. First-install is a one-time,
// single-tenant event so that is acceptable today — revisit if clustering lands.
let issuedToken: string | null = null;

// Once any user exists, `needsBootstrap` is permanently false: the flag only
// ever transitions true→false (when the first user is created) and never back.
// `GET /api/config/public` calls `needsBootstrap` on every request, so once we
// observe a user we cache that result and short-circuit the per-request
// `SELECT id FROM user LIMIT 1`. While no user exists we keep querying so the
// flag flips to false the instant the first user is created within this process.
let userExistsLatch = false;

/** Returns the SHA-256 hex digest of `token`. */
function sha256Hex(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Constant-time check that `suppliedHash` matches the stored token hash and that
 * the row exists and is still unconsumed. Requiring `consumedAt === null` is
 * defense-in-depth: the zero-users assertion already blocks re-claims, but if a
 * user row were ever deleted, a spent token from the boot log must not be
 * replayable.
 */
function tokenMatchesUnconsumed(
  tokenRow: { tokenHash: string; consumedAt: number | null } | undefined,
  suppliedHash: string,
): boolean {
  if (!tokenRow || tokenRow.consumedAt !== null) return false;
  // Compare the raw 32-byte digests (hex-decoded). Both sides are SHA-256 hex, so
  // the buffers are always equal length and `timingSafeEqual` is safe without a
  // separate length guard.
  const suppliedBuf = Buffer.from(suppliedHash, "hex");
  const storedBuf = Buffer.from(tokenRow.tokenHash, "hex");
  return timingSafeEqual(storedBuf, suppliedBuf);
}

/**
 * Test helper: drop the in-memory token so the next ensure call re-issues. Also
 * clears the user-exists latch, since both are per-process bootstrap state that
 * leaks between tests in the same file; resetting them together keeps every
 * `ensureBootstrapToken` test starting from a clean fresh-install state.
 */
export function resetBootstrapTokenForTest(): void {
  issuedToken = null;
  userExistsLatch = false;
}

/** Test helper: clear the user-exists latch so `needsBootstrap` queries again. */
export function resetBootstrapLatchForTest(): void {
  userExistsLatch = false;
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
  // Once a user has been observed the flag is false forever, so skip the query.
  if (userExistsLatch) return false;
  const db = getDb();
  const row = await db.select({ id: user.id }).from(user).limit(1).get();
  if (row) {
    userExistsLatch = true;
    return false;
  }
  return true;
}

/**
 * While the instance is still in bootstrap state, ensures a setup token exists
 * and prints its plaintext to the console in an unmistakable boxed banner. The
 * banner is re-printed on every boot so the operator can always recover the
 * token (e.g. via `docker logs`). A new token is issued only when none is held
 * in memory and no non-consumed row exists; otherwise the existing token is
 * re-printed and nothing new is written. Does nothing once a user exists.
 */
// The CRAP score is coverage-estimated in CI (no --coverage); the token lifecycle
// here is fully exercised by auth/__tests__/bootstrap.test.ts.
// fallow-ignore-next-line complexity
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
 * obtain the admin role. The whole claim — assert, verify, create, consume — runs
 * in one transaction via the shared `insertCredentialUserTx` helper, so the
 * credential account shape stays defined in one place.
 */
export async function claimBootstrap(input: {
  token: string;
  email: string;
  password: string;
  name: string;
}): Promise<{ userId: string }> {
  const { token, email, password, name } = input;
  const db = getDb();
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

    // 2. Load the token row and reject a missing, mismatched, or already-consumed
    //    token before doing any expensive work. Verifying the cheap token hash
    //    first means a bad token never pays the scrypt password-hashing cost.
    const tokenRow = await tx
      .select({ tokenHash: appBootstrap.tokenHash, consumedAt: appBootstrap.consumedAt })
      .from(appBootstrap)
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID))
      .get();
    if (!tokenMatchesUnconsumed(tokenRow, tokenHash)) {
      throw new AuthError("Invalid setup token", "bootstrap.invalid_token");
    }

    // 3. Create the first admin (user + credential account + role_admin). The
    //    bootstrap admin is marked email-verified: reading the console token
    //    proves control of the server.
    const { userId } = await insertCredentialUserTx(tx, {
      email,
      password,
      name,
      roleId: "role_admin",
      emailVerified: true,
    });

    // 4. Mark the token consumed within the same transaction.
    await tx
      .update(appBootstrap)
      .set({ consumedAt: Date.now() })
      .where(eq(appBootstrap.id, BOOTSTRAP_ROW_ID));

    return { userId };
  });
}
