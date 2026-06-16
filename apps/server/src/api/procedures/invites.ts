import { Hono } from "hono";
import { eq, isNull, sql } from "drizzle-orm";
import {
  createInviteSchema,
  extendInviteSchema,
  acceptInviteSchema,
  type AdminInviteDTO,
  type InvitePreviewDTO,
} from "@nama/shared/invites";
import { requireSession, requirePermission, sessionUserId, PERMISSIONS } from "../../auth";
import { insertCredentialUserTx } from "../../auth/internal/create-user";
import { getDb } from "../../db/client";
import { user } from "../../db/schema/auth";
import { roles } from "../../db/schema/auth/roles";
import { invites } from "../../db/schema/auth/invites";
import { zValidator } from "../../diagnostics/validator";
import { badRequest, conflict, forbidden, notFound } from "../../diagnostics/http-errors";
import { HttpError } from "../../diagnostics/http-errors";
import { env } from "../../env";
import { requireAssignableRole } from "./assignable-role";
import { makeRateLimitMiddleware, clientIp } from "../rate-limit";
import { TokenBucketLimiter } from "../../mcp/rate-limit";

// ─── Rate limiters ─────────────────────────────────────────────────────────────

/**
 * Per-IP bucket for public invite preview. Capacity 60 / refill 1/s — same
 * budget class as other public reads. A separate bucket from acceptIpLimiter so
 * a preview burst does not drain the accept budget.
 */
const previewIpLimiter = new TokenBucketLimiter({ capacity: 60, refillPerSec: 1 });

/**
 * Per-IP bucket for invite accept. Tight cap (5 / refill 0.1/s) because each
 * accept runs a scrypt hash; this bounds CPU exposure to ~5 burst requests then
 * one per 10 seconds per IP.
 */
export const acceptIpLimiter = new TokenBucketLimiter({ capacity: 5, refillPerSec: 0.1 });

const previewIpRateLimit = makeRateLimitMiddleware({ limiter: previewIpLimiter, key: clientIp });
const acceptIpRateLimit = makeRateLimitMiddleware({ limiter: acceptIpLimiter, key: clientIp });

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Crockford Base32 alphabet: 0-9, A-Z minus I, L, O, U. ~5 bits per character. */
const BASE32_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * Generates an 18-character invite code grouped as XXXXXX-XXXXXX-XXXXXX.
 * Uses Crockford Base32 (32 symbols) for ~90 bits of entropy while avoiding
 * ambiguous characters (I, L, O, U). Codes are stored in the DB in this format.
 */
function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const chars = Array.from(bytes, (b) => BASE32_ALPHABET[b % 32]!);
  return `${chars.slice(0, 6).join("")}-${chars.slice(6, 12).join("")}-${chars.slice(12, 18).join("")}`;
}

/** Returns the invite URL for a given code using the deployment's APP_EXTERNAL_URL. */
function buildInviteUrl(code: string, requestUrl: string): string {
  const base = env.APP_EXTERNAL_URL ?? new URL(requestUrl).origin;
  return `${base}/auth/invite/${code}`;
}

/** Computes the server-side `expired` flag for an invite row. */
function isExpired(row: {
  expiresAt: number | Date;
  maxUses: number;
  uses: number;
  revokedAt: number | Date | null;
}): boolean {
  const expiresAtMs = row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt;
  const revokedAtMs = row.revokedAt instanceof Date ? row.revokedAt.getTime() : row.revokedAt;
  return (
    expiresAtMs < Date.now() ||
    (row.maxUses !== 0 && row.uses >= row.maxUses) ||
    revokedAtMs !== null
  );
}

// ─── Admin Invites API (/admin/invites) ────────────────────────────────────────

export const adminInvitesApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_USERS))

  /** Create a new invite link. */
  .post("/", zValidator("json", createInviteSchema), async (c) => {
    const { roleId, expiresAt, maxUses } = c.req.valid("json");
    const db = getDb();

    if (expiresAt <= Date.now()) {
      throw badRequest("invites.expires_in_past", "expiresAt must be in the future");
    }

    await requireAssignableRole(roleId);

    // Mint the code, retrying up to 3 times on the astronomically unlikely collision.
    let code: string | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      const candidate = generateInviteCode();
      const existing = await db
        .select({ id: invites.id })
        .from(invites)
        .where(eq(invites.code, candidate))
        .get();
      if (!existing) {
        code = candidate;
        break;
      }
    }
    if (!code) {
      throw new HttpError(500, "invites.code_collision", "Failed to generate a unique invite code");
    }

    const invitedBy = sessionUserId(c);
    const id = crypto.randomUUID();
    const now = Date.now();

    await db.insert(invites).values({
      id,
      code,
      roleId,
      invitedBy,
      createdAt: new Date(now),
      expiresAt: new Date(expiresAt),
      maxUses,
      uses: 0,
    });

    const dto: AdminInviteDTO = {
      id,
      code,
      url: buildInviteUrl(code, c.req.url),
      roleId,
      invitedBy,
      createdAt: now,
      expiresAt,
      maxUses,
      uses: 0,
      expired: false,
    };

    return c.json(dto, 201);
  })

  /** List all non-revoked invites, newest first. */
  .get("/", async (c) => {
    const db = getDb();

    const rows = await db
      .select()
      .from(invites)
      .where(isNull(invites.revokedAt))
      .orderBy(sql`${invites.createdAt} DESC`)
      .all();

    const baseUrl = buildInviteUrl("__code__", c.req.url).replace("__code__", "");

    const result: AdminInviteDTO[] = rows.map((row) => ({
      id: row.id,
      code: row.code,
      url: `${baseUrl}${row.code}`,
      roleId: row.roleId,
      invitedBy: row.invitedBy,
      createdAt: row.createdAt instanceof Date ? row.createdAt.getTime() : row.createdAt,
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt,
      maxUses: row.maxUses,
      uses: row.uses,
      expired: isExpired(row),
    }));

    return c.json({ invites: result });
  })

  /** Extend an invite's expiry. Rejects if already exhausted (uses >= maxUses). */
  .post("/:id/extend", zValidator("json", extendInviteSchema), async (c) => {
    const id = c.req.param("id");
    const { expiresAt } = c.req.valid("json");
    const db = getDb();

    if (expiresAt <= Date.now()) {
      throw badRequest("invites.expires_in_past", "expiresAt must be in the future");
    }

    const row = await db
      .select({
        id: invites.id,
        uses: invites.uses,
        maxUses: invites.maxUses,
        revokedAt: invites.revokedAt,
      })
      .from(invites)
      .where(eq(invites.id, id))
      .get();

    if (!row) {
      throw notFound("invites.not_found", `invite ${id} not found`, { id });
    }

    if (row.revokedAt !== null) {
      throw forbidden("invites.revoked", "revoked invite cannot be extended");
    }

    // An exhausted invite cannot be usefully extended by expiry alone — admin
    // must create a new one.
    if (row.maxUses !== 0 && row.uses >= row.maxUses) {
      throw conflict("INVITE_EXHAUSTED", "invite is fully consumed — create a new one");
    }

    await db
      .update(invites)
      .set({ expiresAt: new Date(expiresAt) })
      .where(eq(invites.id, id));

    return c.json({ ok: true });
  })

  /** Soft-revoke an invite. */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    const row = await db.select({ id: invites.id }).from(invites).where(eq(invites.id, id)).get();

    if (!row) {
      throw notFound("invites.not_found", `invite ${id} not found`, { id });
    }

    await db.update(invites).set({ revokedAt: new Date() }).where(eq(invites.id, id));

    return c.json({ ok: true });
  });

// ─── Public Invites API (/invites) ─────────────────────────────────────────────

export const invitesApp = new Hono()

  /** Preview an invite by code. Returns role info for the registration form. */
  .get("/:code", previewIpRateLimit, async (c) => {
    const code = c.req.param("code");
    const db = getDb();

    const row = await db
      .select({
        id: invites.id,
        expiresAt: invites.expiresAt,
        maxUses: invites.maxUses,
        uses: invites.uses,
        revokedAt: invites.revokedAt,
        roleId: invites.roleId,
        roleName: roles.name,
      })
      .from(invites)
      .leftJoin(roles, eq(roles.id, invites.roleId))
      .where(eq(invites.code, code))
      .get();

    if (!row) {
      throw notFound("invites.not_found", "invite not found");
    }

    if (isExpired(row)) {
      throw new HttpError(410, "invites.expired", "invite has expired or been revoked");
    }

    const preview: InvitePreviewDTO = {
      roleName: row.roleName ?? "",
      expiresAt: row.expiresAt instanceof Date ? row.expiresAt.getTime() : row.expiresAt,
    };

    return c.json(preview);
  })

  /** Accept an invite — creates a user account inside a single transaction. */
  .post("/:code/accept", acceptIpRateLimit, zValidator("json", acceptInviteSchema), async (c) => {
    const code = c.req.param("code");
    const { name, email, password } = c.req.valid("json");
    const db = getDb();

    const { userId } = await db.transaction(async (tx) => {
      // Atomic use-count guard. A single UPDATE filters the full validity
      // predicate; 0 rows changed means the invite is no longer valid.
      const nowMs = Date.now();
      const result = await tx
        .update(invites)
        .set({ uses: sql`${invites.uses} + 1` })
        .where(
          sql`${invites.code} = ${code}
            AND (${invites.maxUses} = 0 OR ${invites.uses} < ${invites.maxUses})
            AND ${invites.expiresAt} > ${nowMs}
            AND ${invites.revokedAt} IS NULL`,
        )
        .returning({ id: invites.id, roleId: invites.roleId });

      if (!result.length) {
        throw new HttpError(
          410,
          "invites.expired",
          "invite has expired, been exhausted, or revoked",
        );
      }

      const inviteRow = result[0]!;

      // Unique-email check within the transaction so a duplicate rolls back
      // the use-count increment from above.
      const existingUser = await tx
        .select({ id: user.id })
        .from(user)
        .where(eq(user.email, email))
        .get();

      if (existingUser) {
        throw conflict(
          "invites.email_taken",
          "an account with this email already exists — sign in instead",
          { email },
        );
      }

      // Create the user + credential account directly (sign-up is disabled globally).
      return insertCredentialUserTx(tx, {
        name,
        email,
        password,
        roleId: inviteRow.roleId,
        emailVerified: true,
      });
    });

    return c.json({ ok: true, userId });
  });
