import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { user, serviceConnections } from "../db/schema";
import { NOTIFICATION_CATEGORIES } from "@ent-mcp/shared/notifications";
import { upsertSubscription } from "./repos";

export async function backfillInboxConnections(): Promise<void> {
  const db = getDb();

  // Find users who already have inbox connections.
  const usersWithInbox = await db
    .select({ userId: serviceConnections.userId })
    .from(serviceConnections)
    .where(eq(serviceConnections.pluginId, "inbox"))
    .all();
  const userIdsWithInbox = new Set(usersWithInbox.map((r) => r.userId));

  // Find all users without inbox connections.
  const allUsers = await db.select({ id: user.id }).from(user).all();
  const usersNeedingBackfill = allUsers.filter((u) => !userIdsWithInbox.has(u.id));

  for (const u of usersNeedingBackfill) {
    const connId = randomUUID();
    const now = Date.now();
    await db.insert(serviceConnections).values({
      id: connId,
      userId: u.id,
      pluginId: "inbox",
      status: "connected",
      createdAt: now,
      updatedAt: now,
    });

    for (const category of NOTIFICATION_CATEGORIES) {
      await upsertSubscription(connId, category, true);
    }
  }
}
