import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client";
import { user, serviceConnections } from "../db/schema";
import { NOTIFICATION_CATEGORIES } from "@ent-mcp/shared/notifications";
import { upsertSubscription } from "./repos";

export async function backfillInboxConnections(): Promise<void> {
  const db = getDb();

  const allUsers = await db.select({ id: user.id }).from(user).all();

  for (const u of allUsers) {
    const existing = await db
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, u.id), eq(serviceConnections.pluginId, "inbox")))
      .get();

    if (!existing) {
      const connId = randomUUID();
      const now = Date.now();
      await db.insert(serviceConnections).values({
        id: connId,
        userId: u.id,
        pluginId: "inbox",
        status: "ready" as const,
        enabled: 1 as const,
        isDefault: 0 as const,
        createdAt: now,
        updatedAt: now,
      } as any);

      for (const category of NOTIFICATION_CATEGORIES) {
        await upsertSubscription(connId, category, true);
      }
    }
  }
}
