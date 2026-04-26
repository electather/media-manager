import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client";
import {
  user,
  userRoles,
  rolePermissions,
  serviceConnections,
  notificationSubscriptions,
} from "../db/schema";
import type { NotificationEvent } from "@ent-mcp/shared/notifications";
import { NOTIFICATION_CATEGORY_PERMISSION } from "@ent-mcp/shared/notifications";

export interface Recipient {
  connectionId: string;
  userId: string;
}

export async function resolveRecipients(event: NotificationEvent): Promise<Recipient[]> {
  const db = getDb();

  const candidateUserIds = await (async () => {
    if (event.audience.kind === "user") {
      return [event.audience.userId];
    }
    if (event.audience.kind === "admin") {
      const rows = await db
        .select({ id: user.id })
        .from(user)
        .innerJoin(userRoles, eq(user.id, userRoles.userId))
        .innerJoin(rolePermissions, eq(userRoles.roleId, rolePermissions.roleId))
        .where(eq(rolePermissions.permission, event.audience.permission))
        .all();
      return rows.map((r) => r.id);
    }
    return [];
  })();

  if (candidateUserIds.length === 0) return [];

  const conns = await db
    .select()
    .from(serviceConnections)
    .innerJoin(
      notificationSubscriptions,
      eq(serviceConnections.id, notificationSubscriptions.connectionId),
    )
    .where(
      and(
        inArray(serviceConnections.userId, candidateUserIds),
        eq(serviceConnections.enabled, 1),
        eq(notificationSubscriptions.category, event.category),
        eq(notificationSubscriptions.enabled, 1),
      ),
    )
    .all();

  // Defense in depth: batch re-check that users still have category permission at dispatch time.
  const requiredPermission = NOTIFICATION_CATEGORY_PERMISSION[event.category];
  const connUserIds = conns.map((r) => r.service_connections.userId);

  const authorizedRows = await db
    .select({ userId: userRoles.userId })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(
      and(
        inArray(userRoles.userId, connUserIds),
        eq(rolePermissions.permission, requiredPermission),
      ),
    )
    .all();

  const authorizedIds = new Set(authorizedRows.map((r) => r.userId));

  return conns
    .filter((r) => authorizedIds.has(r.service_connections.userId))
    .map((r) => ({
      connectionId: r.service_connections.id,
      userId: r.service_connections.userId,
    }));
}
