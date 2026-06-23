// Invite endpoints: `adminInvitesApp` at `/admin/invites` (ADMIN_USERS-gated CRUD),
// `invitesApp` at `/invites` (public preview + accept). Accept runs in a single
// db.transaction so failures roll back the atomic use-count increment.
import { Hono } from "hono";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createInviteSchema, extendInviteSchema, acceptInviteSchema } from "@nama/shared/invites";
import {
  requireSession,
  requirePermission,
  PERMISSIONS,
  sessionUserId,
  roleHasAdminTierPermission,
} from "../../auth";
// Design §4.2 step 4 mandates this exact tx-aware primitive (the same one claimBootstrap composes with
// its own transaction). `hashPassword` is the matching scrypt the sign-in path verifies against; accept
// runs it before opening the transaction so scrypt never holds the write lock (#852 L2).
// fallow-ignore-next-line boundary-violation
import { insertCredentialUserWithHashTx, hashPassword } from "../../auth/internal/create-user";
import { getDb } from "../../db/client";
import { user } from "../../db/schema/auth";
import { roles } from "../../db/schema/auth/roles";
import { invites } from "../../db/schema/auth/invites";
import { zValidator } from "../../diagnostics/validator";
import { notFound, badRequest, conflict, forbidden, internal } from "../../diagnostics/http-errors";
import { env } from "../../env";
import { requireAssignableRole } from "./assignable-role";
import { publicIpRateLimit, acceptIpRateLimit } from "../rate-limit";

// ─── Crockford base32 alphabet (no ambiguous chars: 0-9A-HJKMNP-TV-Z) ────────

const BASE32_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates an 18-char Crockford base32 invite code (~90 bits of entropy)
 * grouped as `XXXXXX-XXXXXX-XXXXXX`. Uses `crypto.getRandomValues` which is
 * available in both Bun and the Vitest/node test runner.
 */
function generateInviteCode(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  // Map each byte to a base32 char; 256/32 = 8, so `byte % 32` is uniform.
  const chars = Array.from(bytes, (b) => BASE32_CHARS[b % 32]);
  return `${chars.slice(0, 6).join("")}-${chars.slice(6, 12).join("")}-${chars.slice(12, 18).join("")}`;
}

/**
 * Builds the invite URL from the server-side origin. Uses `APP_EXTERNAL_URL`
 * when set (production); falls back to `origin` extracted from the request
 * URL in development. The `/auth/invite/<code>` path matches the client route.
 */
function buildInviteUrl(code: string, requestUrl: string): string {
  const base = env.APP_EXTERNAL_URL ?? new URL(requestUrl).origin;
  return `${base}/auth/invite/${code}`;
}

// True when `err` is the `user.email` UNIQUE violation. Pre-INSERT SELECT catches
// most duplicates; this backstops the race where two requests pass the SELECT and
// one loses the UNIQUE race on INSERT. Driver wording varies; scoped to `user.email`
// so unrelated UNIQUEs are not silently rewritten. @internal Exported for unit tests only.
export function isEmailUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Error &&
    (err.message.includes("UNIQUE constraint failed: user.email") ||
      ((err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE" &&
        err.message.includes("user.email")))
  );
}

// ─── Invite helpers ────────────────────────────────────────────────────────────

/**
 * Normalises a timestamp that Drizzle may return as either a `Date` or a raw
 * millisecond integer (driver-dependent) to a consistent ms number.
 */
function toMs(value: Date | number): number {
  return value instanceof Date ? value.getTime() : (value as number);
}

// Implements design §2 formula: expiresAt < now OR (maxUses !== 0 && uses >= maxUses).
// revokedAt excluded here; callers check it separately, list pre-filters it.
function isInviteExpired(
  row: { expiresAt: Date | number; maxUses: number; uses: number },
  now: number,
): boolean {
  return toMs(row.expiresAt) < now || (row.maxUses !== 0 && row.uses >= row.maxUses);
}

// ─── Admin sub-app ─────────────────────────────────────────────────────────────

export const adminInvitesApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_USERS))

  /** Create a new link invite. Returns AdminInviteDTO with url. */
  .post("/", zValidator("json", createInviteSchema), async (c) => {
    const { roleId, expiresAt, maxUses } = c.req.valid("json");
    const db = getDb();

    if (expiresAt <= Date.now()) {
      throw badRequest("invites.expiry_in_past", "expiresAt must be a future timestamp");
    }

    await requireAssignableRole(roleId);

    const invitedBy = sessionUserId(c);

    // Retry up to 3 times on the astronomically unlikely code collision.
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateInviteCode();
      const id = crypto.randomUUID();
      try {
        await db.insert(invites).values({
          id,
          code,
          roleId,
          invitedBy,
          createdAt: new Date(Date.now()),
          expiresAt: new Date(expiresAt),
          maxUses,
          uses: 0,
        });

        return c.json(
          {
            id,
            code,
            url: buildInviteUrl(code, c.req.url),
            roleId,
            invitedBy,
            createdAt: Date.now(),
            expiresAt,
            maxUses,
            uses: 0,
            expired: false,
          },
          201,
        );
      } catch (err) {
        // Retry only on a UNIQUE violation for the `code` column. Narrow the
        // match so an unrelated constraint failure is not silently swallowed by
        // the retry loop (driver wording varies, so accept either form).
        const isCodeCollision =
          err instanceof Error &&
          (err.message.includes("UNIQUE constraint failed: invites.code") ||
            ("code" in err && (err as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE"));
        if (isCodeCollision) {
          lastError = err;
          continue;
        }
        throw err;
      }
    }
    throw internal(
      "invites.code_collision",
      `failed to generate unique code: ${String(lastError)}`,
    );
  })

  /** List all non-revoked invites, newest first, with computed `expired`. */
  .get("/", async (c) => {
    const db = getDb();
    const now = Date.now();

    const rows = await db
      .select({
        id: invites.id,
        code: invites.code,
        roleId: invites.roleId,
        invitedBy: invites.invitedBy,
        createdAt: invites.createdAt,
        expiresAt: invites.expiresAt,
        maxUses: invites.maxUses,
        uses: invites.uses,
      })
      .from(invites)
      .where(isNull(invites.revokedAt))
      .orderBy(sql`${invites.createdAt} DESC`)
      .all();

    const result = rows.map((r) => ({
      id: r.id,
      code: r.code,
      url: buildInviteUrl(r.code, c.req.url),
      roleId: r.roleId,
      invitedBy: r.invitedBy ?? null,
      createdAt: toMs(r.createdAt),
      expiresAt: toMs(r.expiresAt),
      maxUses: r.maxUses,
      uses: r.uses,
      // The `revokedAt != null` term from the design §2 formula is intentionally
      // omitted: the query already pre-filters `WHERE revokedAt IS NULL`, so
      // revoked rows never appear in this list.
      expired: isInviteExpired(r, now),
    }));

    return c.json({ invites: result });
  })

  /** Extend an invite's expiry. Rejects already-exhausted invites (409). */
  .post("/:id/extend", zValidator("json", extendInviteSchema), async (c) => {
    const id = c.req.param("id");
    const { expiresAt } = c.req.valid("json");
    const db = getDb();

    if (expiresAt <= Date.now()) {
      throw badRequest("invites.expiry_in_past", "expiresAt must be a future timestamp");
    }

    const row = await db
      .select({
        id: invites.id,
        maxUses: invites.maxUses,
        uses: invites.uses,
        revokedAt: invites.revokedAt,
      })
      .from(invites)
      .where(eq(invites.id, id))
      .get();

    if (!row) {
      throw notFound("invites.not_found", `invite ${id} not found`, { id });
    }

    // Extending a revoked invite is meaningless — `accept` still rejects it on
    // the `revokedAt` check, so a 200 here would leave the link permanently
    // unusable. Reject and ask the admin to create a new one.
    if (row.revokedAt) {
      throw conflict("invites.revoked", "invite is already revoked; create a new one");
    }

    // Extending a fully-exhausted invite is pointless — the link can never
    // be used again, so reject and ask the admin to create a new one.
    if (row.maxUses !== 0 && row.uses >= row.maxUses) {
      throw conflict("invites.exhausted", "invite is fully consumed; create a new one");
    }

    await db
      .update(invites)
      .set({ expiresAt: new Date(expiresAt) })
      .where(eq(invites.id, id));

    return c.json({ ok: true });
  })

  /** Soft-revoke an invite (sets revokedAt = now). Idempotent. */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    const row = await db
      .select({ id: invites.id, revokedAt: invites.revokedAt })
      .from(invites)
      .where(eq(invites.id, id))
      .get();

    if (!row) {
      throw notFound("invites.not_found", `invite ${id} not found`, { id });
    }

    // Idempotent: a second revoke must not overwrite the original timestamp,
    // which is kept for the audit trail.
    if (row.revokedAt) {
      return c.json({ ok: true });
    }

    await db
      .update(invites)
      .set({ revokedAt: new Date(Date.now()) })
      .where(eq(invites.id, id));

    return c.json({ ok: true });
  });

// ─── Public sub-app ────────────────────────────────────────────────────────────

export const invitesApp = new Hono()

  /**
   * Preview an invite by code. Returns a minimal DTO (roleName + expiresAt)
   * so the accepter knows what they are signing up for. Keyed by IP with the
   * same budget as other public reads.
   */
  .get("/:code", publicIpRateLimit, async (c) => {
    const code = c.req.param("code");
    const db = getDb();
    const now = Date.now();

    const row = await db
      .select({
        roleId: invites.roleId,
        expiresAt: invites.expiresAt,
        maxUses: invites.maxUses,
        uses: invites.uses,
        revokedAt: invites.revokedAt,
        roleName: roles.name,
      })
      .from(invites)
      .leftJoin(roles, eq(roles.id, invites.roleId))
      .where(eq(invites.code, code))
      .get();

    if (!row) return c.json({ code: "invites.not_found" }, 404);

    const expiresAtMs = toMs(row.expiresAt);
    const isExpired = isInviteExpired(row, now) || row.revokedAt !== null;

    if (isExpired) return c.json({ code: "invites.gone" }, 410);

    // A null roleName means the referenced role was deleted (orphaned invite).
    // The link is no longer meaningful — treat it as gone rather than handing
    // back a blank role and letting accept assign a ghost role.
    if (!row.roleName) return c.json({ code: "invites.gone" }, 410);

    return c.json({ roleName: row.roleName, expiresAt: expiresAtMs });
  })

  // Create account and increment use counter in a single transaction so any
  // failure rolls back the use increment. Returns {ok: true}; client signs in after.
  .post("/:code/accept", acceptIpRateLimit, zValidator("json", acceptInviteSchema), async (c) => {
    const code = c.req.param("code");
    const { name, email, password } = c.req.valid("json");
    const db = getDb();

    // Preflight: cheap validity check before the ~100ms scrypt hash, reducing
    // CPU exposure from public bogus accepts. TOCTOU-safe — the in-transaction
    // UPDATE (step 1) is the authoritative race-safe guard; this only avoids
    // paying hash cost for obviously-invalid codes.
    const preflightNow = Date.now();
    const preflightExists = await db
      .select({ id: invites.id })
      .from(invites)
      .where(
        and(
          eq(invites.code, code),
          or(eq(invites.maxUses, 0), sql`${invites.uses} < ${invites.maxUses}`),
          gt(invites.expiresAt, new Date(preflightNow)),
          isNull(invites.revokedAt),
        ),
      )
      .get();
    if (!preflightExists) return c.json({ code: "invites.gone" }, 410);

    // Hash the password BEFORE opening the transaction. scrypt is deliberately
    // ~100ms, and `db.transaction` issues `BEGIN IMMEDIATE` (SQLite's single-writer
    // lock) up front — hashing inside would hold that lock for the full hash on
    // every accept, queuing other writers until `busy_timeout` fails them (#852 L2).
    const passwordHash = await hashPassword(password);

    try {
      await db.transaction(async (tx) => {
        // 1. Atomic use guard: conditional UPDATE in WHERE clause (design §4.2 step 1),
        //    race-safe even under multi-writer (libSQL/Turso). .returning() avoids
        //    second read. Zero rows ⇒ consumed/expired/revoked ⇒ 410.
        const nowMs = Date.now();
        const [inv] = await tx
          .update(invites)
          .set({ uses: sql`${invites.uses} + 1` })
          .where(
            and(
              eq(invites.code, code),
              or(eq(invites.maxUses, 0), sql`${invites.uses} < ${invites.maxUses}`),
              gt(invites.expiresAt, new Date(nowMs)),
              isNull(invites.revokedAt),
            ),
          )
          .returning({ roleId: invites.roleId });

        if (!inv) throw new Error("INVITE_GONE");

        // 2. Re-validate the bound role at consumption time. Both checks read the
        //    *current committed* role state — these rows are never mutated by this
        //    transaction, so reading the role's slug here (and its permissions via
        //    the auth barrel below) is correct and cannot deadlock the open write:
        //    libSQL readers never block on a writer.
        const role = await tx
          .select({ id: roles.id, systemSlug: roles.systemSlug })
          .from(roles)
          .where(eq(roles.id, inv.roleId))
          .get();
        //   (a) Role deleted since the invite was minted ⇒ mirror the preview's
        //       orphaned-role guard (a null roleName there → 410) instead of
        //       assigning a permissionless ghost role / hitting the role_id FK (L1b).
        if (!role) throw new Error("INVITE_GONE");
        //   (b) Re-run #576 escalation guard at consumption time: role gained
        //       admin-tier permission after minting ⇒ reject (L1a). Inside txn so
        //       rejection rolls back use increment. roleHasAdminTierPermission sees
        //       latest committed state, which the guard requires.
        if (await roleHasAdminTierPermission(role.id, role.systemSlug)) {
          throw forbidden(
            "invites.admin_role",
            "this invite's role now grants admin-tier permissions and can no longer be accepted",
          );
        }

        // 3. Unique-email check inside the transaction (not via requireUniqueEmail,
        //    which calls getDb() directly and is not tx-aware).
        const dup = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
        if (dup) {
          throw new Error("EMAIL_TAKEN");
        }

        // 4. Create the account from the precomputed hash. emailVerified=true
        //    because holding a valid invite link is sufficient proof of access
        //    (design §4.2 step 4).
        await insertCredentialUserWithHashTx(tx, {
          name,
          email,
          passwordHash,
          roleId: inv.roleId,
          emailVerified: true,
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INVITE_GONE") {
        return c.json({ code: "invites.gone" }, 410);
      }
      // Step 3 narrows the common duplicate to a clean 409, but two requests for
      // the same new email can both pass that SELECT and one then loses the
      // `user.email` UNIQUE race on INSERT. Map that to the same 409 (the txn still
      // rolled back the increment) rather than leaking a raw 500.
      if (err instanceof Error && (err.message === "EMAIL_TAKEN" || isEmailUniqueViolation(err))) {
        throw conflict(
          "invites.email_taken",
          "an account with this email already exists — please sign in",
          { email },
        );
      }
      throw err;
    }

    return c.json({ ok: true });
  });
