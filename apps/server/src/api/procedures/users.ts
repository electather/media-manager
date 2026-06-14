import { Hono } from "hono";
import { eq, sql } from "drizzle-orm";
import { assignRoleSchema, createUserSchema, updateUserSchema } from "@nama/shared/users";
import {
  requireSession,
  requirePermission,
  sessionUserId,
  PERMISSIONS,
  SYSTEM_ADMIN_ROLE_SLUG,
  createUser,
  createUserWithRole,
} from "../../auth";
import { getDb } from "../../db/client";
import {
  user,
  session,
  oauthAccessToken,
  oauthRefreshToken,
  oauthConsent,
} from "../../db/schema/auth";
import { userRoles, roles } from "../../db/schema/auth/roles";
import { zValidator } from "../../diagnostics/validator";
import { notFound, badRequest, forbidden } from "../../diagnostics/http-errors";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const userWithRoleColumns = {
  id: user.id,
  name: user.name,
  email: user.email,
  emailVerified: user.emailVerified,
  image: user.image,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  roleId: userRoles.roleId,
  roleName: roles.name,
} as const;

function userNotFound(userId: string) {
  return notFound("users.not_found", `user ${userId} not found`, { userId });
}

async function requireUser(userId: string) {
  const db = getDb();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).get();
  if (!existing) throw userNotFound(userId);
  return existing;
}

async function requireRole(roleId: string): Promise<{ id: string; systemSlug: string | null }> {
  const db = getDb();
  const roleExists = await db
    .select({ id: roles.id, systemSlug: roles.systemSlug })
    .from(roles)
    .where(eq(roles.id, roleId))
    .get();
  if (!roleExists) {
    throw badRequest("users.role_not_found", `role ${roleId} does not exist`, { roleId });
  }
  return roleExists;
}

async function requireUniqueEmail(email: string, excludeUserId?: string) {
  const db = getDb();
  const duplicate = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).get();
  if (duplicate && duplicate.id !== excludeUserId) {
    throw badRequest("users.email_taken", `email ${email} is already registered`, { email });
  }
}

function buildUserWithRoleQuery(db: ReturnType<typeof getDb>) {
  return db
    .select(userWithRoleColumns)
    .from(user)
    .leftJoin(userRoles, eq(userRoles.userId, user.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId));
}

/** Fetches all users with their assigned role. */
async function listAllUsers() {
  const db = getDb();
  const rows = await buildUserWithRoleQuery(db).all();

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    emailVerified: r.emailVerified,
    image: r.image,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    role: r.roleId ? { id: r.roleId, name: r.roleName } : null,
  }));
}

/** Counts active sessions for a given user. */
async function activeSessionCount(userId: string): Promise<number> {
  const db = getDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(session)
    .where(eq(session.userId, userId))
    .get();
  return result?.count ?? 0;
}

// ─── Admin Users API (admin:users) ────────────────────────────────────────────

export const adminUsersApp = new Hono()
  .use("*", requireSession)
  .use("*", requirePermission(PERMISSIONS.ADMIN_USERS))

  /** List all users with their role. */
  .get("/", async (c) => {
    const users = await listAllUsers();
    return c.json({ users });
  })

  /** Get a single user by id. */
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    const row = await buildUserWithRoleQuery(db).where(eq(user.id, id)).get();

    if (!row) throw userNotFound(id);

    const sessions = await activeSessionCount(id);

    return c.json({
      user: {
        id: row.id,
        name: row.name,
        email: row.email,
        emailVerified: row.emailVerified,
        image: row.image,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        role: row.roleId ? { id: row.roleId, name: row.roleName } : null,
        activeSessions: sessions,
      },
    });
  })

  /** Create a new user with the direct-insert helper (sign-up is disabled). */
  .post("/", zValidator("json", createUserSchema), async (c) => {
    const { name, email, password, roleId } = c.req.valid("json");

    await requireUniqueEmail(email);
    if (roleId) {
      const role = await requireRole(roleId);
      if (role.systemSlug === SYSTEM_ADMIN_ROLE_SLUG) {
        throw forbidden("users.system_role", "Admin role cannot be assigned via this endpoint");
      }
    }

    const { userId: newUserId } = roleId
      ? await createUserWithRole({ name, email, password, roleId })
      : await createUser({ name, email, password });

    return c.json({ userId: newUserId }, 201);
  })

  /** Update user name or email. */
  .patch("/:id", zValidator("json", updateUserSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const db = getDb();

    const existing = await db.select({ email: user.email }).from(user).where(eq(user.id, id)).get();
    if (!existing) throw userNotFound(id);

    if (body.email) {
      await requireUniqueEmail(body.email, id);
    }

    // Only reset emailVerified when the email actually changes.
    const emailChanged = body.email !== undefined && body.email !== existing.email;

    await db
      .update(user)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
        ...(emailChanged && { emailVerified: false }),
      })
      .where(eq(user.id, id));

    return c.json({ ok: true });
  })

  /** Assign or change a user's role. */
  .put("/:id/role", zValidator("json", assignRoleSchema), async (c) => {
    const id = c.req.param("id");
    const { roleId } = c.req.valid("json");
    const db = getDb();

    await requireUser(id);
    const role = await requireRole(roleId);

    if (role.systemSlug === SYSTEM_ADMIN_ROLE_SLUG) {
      throw forbidden("users.system_role", "Admin role cannot be assigned via this endpoint");
    }

    await db
      .insert(userRoles)
      .values({ userId: id, roleId, assignedAt: Date.now() })
      .onConflictDoUpdate({
        target: userRoles.userId,
        set: { roleId, assignedAt: Date.now() },
      });

    return c.json({ ok: true });
  })

  /** Revoke all sessions for a user (force sign-out). */
  .post("/:id/revoke-sessions", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    await requireUser(id);

    // Prevent admins from revoking their own sessions.
    if (id === sessionUserId(c)) {
      throw badRequest("users.self_revoke", "cannot revoke your own sessions");
    }

    // Wrap in a transaction so a failure mid-sequence cannot leave a refresh
    // token (or consent row) behind after sessions have already been cleared
    // — that would let the holder mint fresh access tokens indefinitely or
    // silently re-authorize without a consent prompt.
    //
    // Consent rows are cleared so the next OAuth grant from the same client
    // requires an explicit re-consent. This mirrors the user-initiated
    // revoke flow in `me/apps.ts` (see `revokeAuthorizedApp`) and matches
    // the security intent of an admin "force sign-out": a hard reset, not a
    // silent re-attach.
    await db.transaction(async (tx) => {
      await tx.delete(session).where(eq(session.userId, id));
      await tx.delete(oauthAccessToken).where(eq(oauthAccessToken.userId, id));
      await tx.delete(oauthRefreshToken).where(eq(oauthRefreshToken.userId, id));
      await tx.delete(oauthConsent).where(eq(oauthConsent.userId, id));
    });

    return c.json({ ok: true });
  })

  /** Delete a user account. Cascades via FK constraints. */
  .delete("/:id", async (c) => {
    const id = c.req.param("id");
    const db = getDb();

    // Prevent self-deletion.
    if (id === sessionUserId(c)) {
      throw forbidden("users.self_delete", "cannot delete your own account");
    }

    await requireUser(id);

    await db.delete(user).where(eq(user.id, id));

    return c.json({ ok: true });
  });
