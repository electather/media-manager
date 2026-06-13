import type { Context, Next } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import {
  NOTIFICATION_CATEGORY_PERMISSION,
  type NotificationCategory,
  type NotificationContentKind,
} from "@nama/shared/notifications";
import { loadUserRole, roleHasPermission } from "../../../auth";
import { getDb } from "../../../db/client";
import { serviceConnections } from "../../../db/schema";
import { env } from "../../../env";
import { badRequest, forbidden, notFound } from "../../../diagnostics/http-errors";
import { capabilityRegistry } from "../../../plugin-runtime";

export const NOTIFICATION_CAPABILITY_ID = "notificationDelivery";
export const NOTIFICATION_CAPABILITY_VERSION = "v1";

export const SUBSCRIPTION_BULK_LIMIT = 200;

export const CATEGORY_LABELS: Record<NotificationCategory, { label: string; description: string }> =
  {
    media: { label: "Media", description: "Requests, availability, denials" },
    sync: { label: "Sync", description: "Connection sync results" },
    auth: { label: "Authentication", description: "Connection auth lifecycle" },
    system: { label: "System", description: "Server-level alerts" },
  };

export function flagGate() {
  return async (_c: Context, next: Next): Promise<void> => {
    if (!env.NOTIFICATIONS_ENABLED) {
      throw notFound("notifications.disabled", "notifications feature is disabled");
    }
    await next();
  };
}

export function notificationCapablePluginIds(): Set<string> {
  return new Set(
    capabilityRegistry.listProviders(
      NOTIFICATION_CAPABILITY_ID,
      NOTIFICATION_CAPABILITY_VERSION,
      "user",
    ),
  );
}

export function manifestSupportsKinds(pluginId: string): NotificationContentKind[] {
  const entry = capabilityRegistry.get(pluginId);
  const cap = entry?.module.manifest.capabilities[NOTIFICATION_CAPABILITY_ID];
  return cap?.supportsKinds ?? ["text"];
}

// Shared keyset cursor format used by inbox listing AND admin deliveries:
// `base64url(<created_at_ms>|<id>)`. Epoch milliseconds (not ISO) keeps the
// payload short and avoids escaping the `:` characters inside ISO-8601.
// Both endpoints decode/encode through the same helpers so cursors are
// interchangeable across consumers.
const CURSOR_SEP = "|";

// fallow-ignore-next-line complexity
export function decodeKeysetCursor(
  cursor: string | undefined,
): { createdAt: number; id: string } | undefined {
  if (!cursor) return undefined;
  // Decode without a try/catch: every transformation here is total over
  // strings (Buffer.from with explicit base64url, indexOf, slice, Number).
  // Validate the resulting shape and surface a 400 for malformed cursors;
  // any genuinely unexpected runtime error from this code path should
  // propagate as a 500 rather than be hidden behind "invalid cursor".
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const sep = decoded.indexOf(CURSOR_SEP);
  if (sep <= 0) {
    throw badRequest("notifications.bad_cursor", "invalid cursor");
  }
  const createdAt = Number(decoded.slice(0, sep));
  const id = decoded.slice(sep + 1);
  if (!Number.isFinite(createdAt) || !id) {
    throw badRequest("notifications.bad_cursor", "invalid cursor");
  }
  return { createdAt, id };
}

export function encodeKeysetCursor(createdAt: number, id: string): string {
  return Buffer.from(`${createdAt}${CURSOR_SEP}${id}`, "utf8").toString("base64url");
}

/** Throws 403 when any of the provided connection ids does not belong to
 * the user. The single SELECT is the only DB hit per bulk request. */
export async function assertOwnsConnections(
  userId: string,
  connectionIds: string[],
): Promise<void> {
  if (connectionIds.length === 0) return;
  const owned = await getDb()
    .select({ id: serviceConnections.id })
    .from(serviceConnections)
    .where(
      and(eq(serviceConnections.userId, userId), inArray(serviceConnections.id, connectionIds)),
    )
    .all();
  const ownedSet = new Set(owned.map((r) => r.id));
  for (const id of connectionIds) {
    if (!ownedSet.has(id)) {
      throw forbidden("notifications.foreign_channel", "channel does not belong to user");
    }
  }
}

/** Throws 403 when the user lacks the gating permission for any of the
 * provided categories. Loads the role row once and reuses it across the
 * category checks. */
// fallow-ignore-next-line complexity
export async function assertCanWriteCategories(
  userId: string,
  categories: NotificationCategory[],
): Promise<void> {
  if (categories.length === 0) return;
  const role = await loadUserRole(userId);
  if (!role) throw forbidden();
  for (const cat of categories) {
    if (!(await roleHasPermission(role, NOTIFICATION_CATEGORY_PERMISSION[cat]))) {
      throw forbidden();
    }
  }
}
