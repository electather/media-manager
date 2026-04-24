import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { RoleSummary } from "@ent-mcp/shared/users";
import { requireSession, sessionUserId } from "../../auth/middleware";
import { getDb } from "../../db/client";
import { userRoles, roles } from "../../db/schema/roles";

export const meApp = new Hono().use("*", requireSession).get("/role", async (c) => {
  const userId = sessionUserId(c);
  const db = getDb();

  const row = await db
    .select({ name: roles.name, description: roles.description })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();

  const role: RoleSummary | null = row ? { name: row.name, description: row.description } : null;
  return c.json({ role });
});
