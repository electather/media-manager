import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { RoleSummary } from "@ent-mcp/shared/users";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { getDb } from "../../db/client";
import { userRoles, roles } from "../../db/schema/roles";
import { notFound } from "../../errors/http-errors";

/**
 * Hono sub-app rooted at `/api/me` for user-scoped settings endpoints.
 *
 * All routes require an authenticated session — we apply `requireSession`
 * once at the sub-app level (mirroring `connectionsApp`). Subsequent issues
 * in the user-settings epic (#75) will add `/apps`, `/export`, and `DELETE /`.
 */
export const meApp = new Hono()
  .use("*", requireSession)
  /**
   * Returns a `RoleSummary` for the authenticated user, or 404 when the
   * user has no role assignment. The frontend reads this to render the
   * role pill on the settings profile page.
   */
  .get("/role", async (c) => {
    const userId = sessionUserId(c);
    const db = getDb();

    const row = await db
      .select({ name: roles.name, description: roles.description })
      .from(userRoles)
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .where(eq(userRoles.userId, userId))
      .get();

    if (!row) {
      throw notFound("me.role_not_assigned", "user has no role assignment", { userId });
    }

    const role: RoleSummary = { name: row.name, description: row.description };
    return c.json(role);
  });
