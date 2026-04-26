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

async function userHasPermission(userId: string, permission: string): Promise<boolean> {
  const db = getDb();
  const result = await db
    .select({ permission: rolePermissions.permission })
    .from(rolePermissions)
    .innerJoin(userRoles, eq(rolePermissions.roleId, userRoles.roleId))
    .where(and(eq(userRoles.userId, userId), eq(rolePermissions.permission, permission)))
    .get();
  return !!result;
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

  const recipients: Recipient[] = [];
  const requiredPermission = NOTIFICATION_CATEGORY_PERMISSION[event.category];

  for (const row of conns) {
    const conn = row.service_connections;
    // Defense in depth: re-check user has category permission at dispatch time.
    const hasPermission = await userHasPermission(conn.userId, requiredPermission);
    if (hasPermission) {
      recipients.push({ connectionId: conn.id, userId: conn.userId });
    }
  }

  return recipients;
}
