import { eq } from "drizzle-orm";
import type { Db } from "../../../db/client";
import { roles, userRoles } from "../../../db/schema/roles";

export async function fetchUserRole(
  db: Db,
  userId: string,
): Promise<{ name: string; description: string | null } | null> {
  const row = await db
    .select({ name: roles.name, description: roles.description })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .get();
  return row ?? null;
}
