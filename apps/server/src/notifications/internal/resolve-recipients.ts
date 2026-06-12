import { listUsersHavingPermission, usersHavingPermission } from "../../auth";
import { listEnabledConnectionsForUsers } from "../../plugin-runtime";
import type { NotificationEvent } from "@nama/shared/notifications";
import { NOTIFICATION_CATEGORY_PERMISSION } from "@nama/shared/notifications";
import * as subscriptions from "../repo/subscriptions";
import type { Recipient } from "../types";

/**
 * Resolves recipients for a notification event. Routes user/role permission
 * reads through the `auth` barrel and service-connection reads through the
 * `plugin-runtime` barrel so notifications never touches a table it does not
 * own. Defense-in-depth re-check at dispatch time so a permission revoked
 * between emit and delivery does not leak.
 */
export async function resolveRecipients(event: NotificationEvent): Promise<Recipient[]> {
  const candidateUserIds = await collectAudience(event);
  if (candidateUserIds.length === 0) return [];

  const connections = await listEnabledConnectionsForUsers(candidateUserIds);
  if (connections.length === 0) return [];

  const subscribed = await subscriptions.listEnabledSubscriptions(
    connections.map((c) => c.id),
    event.category,
  );
  const matched = connections.filter((c) => subscribed.has(c.id));
  if (matched.length === 0) return [];

  const requiredPermission = NOTIFICATION_CATEGORY_PERMISSION[event.category];
  const authorized = await usersHavingPermission(
    matched.map((c) => c.userId),
    requiredPermission,
  );

  return matched
    .filter((c) => authorized.has(c.userId))
    .map((c) => ({ connectionId: c.id, userId: c.userId }));
}

async function collectAudience(event: NotificationEvent): Promise<string[]> {
  if (event.audience.kind === "user") return [event.audience.userId];
  if (event.audience.kind === "admin") {
    return listUsersHavingPermission(event.audience.permission);
  }
  return [];
}
