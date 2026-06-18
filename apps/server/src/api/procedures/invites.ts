/**
 * Invite endpoints — two sub-apps registered in `router.ts`:
 *
 *   `adminInvitesApp` at `/admin/invites`  — ADMIN_USERS-gated CRUD.
 *   `invitesApp`      at `/invites`        — public preview + accept.
 *
 * The accept path runs entirely inside a single `db.transaction` so a
 * later failure (duplicate email, user-creation error) rolls back the
 * atomic use-count increment and no use is silently burned.
 */
import { Hono } from "hono";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";
import { createInviteSchema, extendInviteSchema, acceptInviteSchema } from "@nama/shared/invites";
import { requireSession, requirePermission, PERMISSIONS, sessionUserId } from "../../auth";
// Design §4.2 step 3 mandates this exact tx-aware primitive (the same one claimBootstrap composes with its own transaction).
// fallow-ignore-next-line boundary-violation
import { insertCredentialUserTx } from "../../auth/internal/create-user";
import { getDb } from "../../db/client";
import { user } from "../../db/schema/auth";
import { roles } from "../../db/schema/auth/roles";
import { invites } from "../../db/schema/auth/invites";
import { zValidator } from "../../diagnostics/validator";
import { notFound, badRequest, conflict, internal } from "../../diagnostics/http-errors";
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
      createdAt: r.createdAt instanceof Date ? r.createdAt.getTime() : (r.createdAt as number),
      expiresAt: r.expiresAt instanceof Date ? r.expiresAt.getTime() : (r.expiresAt as number),
      maxUses: r.maxUses,
      uses: r.uses,
      expired:
        (r.expiresAt instanceof Date ? r.expiresAt.getTime() : (r.expiresAt as number)) < now ||
        (r.maxUses !== 0 && r.uses >= r.maxUses),
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

    const expiresAtMs =
      row.expiresAt instanceof Date ? row.expiresAt.getTime() : (row.expiresAt as number);
    const isExpired =
      expiresAtMs < now || (row.maxUses !== 0 && row.uses >= row.maxUses) || row.revokedAt !== null;

    if (isExpired) return c.json({ code: "invites.gone" }, 410);

    // A null roleName means the referenced role was deleted (orphaned invite).
    // The link is no longer meaningful — treat it as gone rather than handing
    // back a blank role and letting accept assign a ghost role.
    if (!row.roleName) return c.json({ code: "invites.gone" }, 410);

    return c.json({ roleName: row.roleName, expiresAt: expiresAtMs });
  })

  /**
   * Accept an invite — create an account and increment the use counter.
   * The entire operation (use-count guard + duplicate-email check + user
   * creation) runs in a single transaction so any failure rolls back the
   * use increment.
   *
   * Returns `{ ok: true, userId }` — no session is created server-side.
   * The client signs in immediately after with the submitted credentials.
   */
  .post("/:code/accept", acceptIpRateLimit, zValidator("json", acceptInviteSchema), async (c) => {
    const code = c.req.param("code");
    const { name, email, password } = c.req.valid("json");
    const db = getDb();

    try {
      await db.transaction(async (tx) => {
        // 1. Atomic use guard: a single conditional UPDATE that increments the
        //    use counter only when the invite is still valid (design §4.2 step 1).
        //    The guard lives entirely in the WHERE clause, so it is race-safe even
        //    under a multi-writer backend (libSQL/Turso) — no read-then-write
        //    window. `.returning()` hands back the role so we avoid a second read.
        //    Zero rows returned ⇒ consumed/expired/revoked ⇒ 410 Gone.
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

        // 2. Unique-email check inside the transaction (not via requireUniqueEmail,
        //    which calls getDb() directly and is not tx-aware).
        const dup = await tx.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
        if (dup) {
          throw new Error("EMAIL_TAKEN");
        }

        // 3. Create the account. emailVerified=true because holding a valid
        //    invite link is sufficient proof of access (design §4.2 step 3).
        await insertCredentialUserTx(tx, {
          name,
          email,
          password,
          roleId: inv.roleId,
          emailVerified: true,
        });
      });
    } catch (err) {
      if (err instanceof Error && err.message === "INVITE_GONE") {
        return c.json({ code: "invites.gone" }, 410);
      }
      if (err instanceof Error && err.message === "EMAIL_TAKEN") {
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
