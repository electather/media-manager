import { Hono } from "hono";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { requireSession, requirePermission, sessionUserId } from "../../auth/middleware";
import { PERMISSIONS } from "../../auth/permissions";
import { getDb } from "../../db/client";
import { user, session } from "../../db/schema/auth";
import { userRoles, roles } from "../../db/schema/roles";
import { zValidator } from "../../errors/validator";
import { notFound, badRequest, forbidden } from "../../errors/http-errors";
import { auth } from "../../auth/config";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createUserSchema = z.object({
  name: z.string().min(1),
  email: z.email(),
  password: z.string().min(8),
  roleId: z.string().optional(),
});

const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.email().optional(),
});

const assignRoleSchema = z.object({
  roleId: z.string().min(1),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function userNotFound(userId: string) {
  return notFound("users.not_found", `user ${userId} not found`, { userId });
}

async function requireUser(userId: string) {
  const db = getDb();
  const existing = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).get();
  if (!existing) throw userNotFound(userId);
  return existing;
}

async function requireRole(roleId: string) {
  const db = getDb();
  const roleExists = await db
    .select({ id: roles.id })
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

/** Fetches all users with their assigned role. */
async function listAllUsers() {
  const db = getDb();
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      roleId: userRoles.roleId,
      roleName: roles.name,
    })
    .from(user)
    .leftJoin(userRoles, eq(userRoles.userId, user.id))
    .leftJoin(roles, eq(roles.id, userRoles.roleId))
    .all();

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

    const row = await db
      .select({
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        roleId: userRoles.roleId,
        roleName: roles.name,
      })
      .from(user)
      .leftJoin(userRoles, eq(userRoles.userId, user.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(user.id, id))
      .get();

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

  /** Create a new user via Better Auth's sign-up flow. */
  .post("/", zValidator("json", createUserSchema), async (c) => {
    const { name, email, password, roleId } = c.req.valid("json");
    const db = getDb();

    await requireUniqueEmail(email);
    if (roleId) {
      await requireRole(roleId);
    }

    const result = await auth.api.signUpEmail({
      body: { name, email, password },
    });
    const newUserId = result.user.id;

    if (roleId) {
      await db.insert(userRoles).values({ userId: newUserId, roleId, assignedAt: Date.now() });
    }

    return c.json({ userId: newUserId }, 201);
  })

  /** Update user name or email. */
  .patch("/:id", zValidator("json", updateUserSchema), async (c) => {
    const id = c.req.param("id");
    const body = c.req.valid("json");
    const db = getDb();

    await requireUser(id);

    if (body.email) {
      await requireUniqueEmail(body.email, id);
    }

    await db
      .update(user)
      .set({
        ...(body.name !== undefined && { name: body.name }),
        ...(body.email !== undefined && { email: body.email }),
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
    await requireRole(roleId);

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

    await db.delete(session).where(eq(session.userId, id));

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
