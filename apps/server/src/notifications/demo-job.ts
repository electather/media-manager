import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  type NotificationCategory,
} from "@ent-mcp/shared/notifications";
import { getDb } from "../db/client";
import { notificationSubscriptions, serviceConnections } from "../db/schema";
import { registerTriggerable } from "../jobs/triggerable";
import { encryptJson } from "../crypto/helpers";
import { emit } from "./emit";

interface DemoInput {
  userId: string;
  category?: NotificationCategory;
  title?: string;
  body?: string;
}

const inputJsonSchema = {
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "Recipient user",
      "x-picker": "user",
    },
    category: {
      type: "string",
      enum: [...NOTIFICATION_CATEGORIES],
      description: "Notification category (defaults to media)",
    },
    title: { type: "string", description: "Optional title override" },
    body: { type: "string", description: "Optional body override" },
  },
  required: ["userId"],
} as const;

async function ensureInboxConnection(userId: string): Promise<string> {
  const db = getDb();
  const existing = await db
    .select({ id: serviceConnections.id })
    .from(serviceConnections)
    .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.pluginId, "inbox")))
    .get();
  if (existing) return existing.id;
  const id = randomUUID();
  const now = Date.now();
  const credEnc = await encryptJson({ kind: "inbox" });
  await db.insert(serviceConnections).values({
    id,
    userId,
    pluginId: "inbox",
    status: "connected",
    enabled: 1,
    isDefault: 1,
    displayName: "Inbox",
    encryptedCredentials: credEnc.data,
    credentialsIv: credEnc.iv,
    userConfig: null,
    tokenExpiresAt: null,
    lastVerifiedAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return id;
}

async function ensureSubscription(connectionId: string, category: NotificationCategory) {
  const db = getDb();
  await db
    .insert(notificationSubscriptions)
    .values({ connectionId, category, enabled: 1 })
    .onConflictDoUpdate({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.category],
      set: { enabled: 1 },
    });
}

export function registerDemoNotificationJob() {
  registerTriggerable<DemoInput, { recipientUserId: string; connectionId: string }>({
    id: "host.notifications.demo",
    name: "Send demo notification",
    description: "Emits a demo notification to the chosen user. Useful for verifying delivery.",
    requiredPermission: "admin:jobs",
    inputSchema: inputJsonSchema as unknown as Record<string, unknown>,
    handler: async (_ctx, input) => {
      if (!input || typeof input.userId !== "string" || !input.userId) {
        throw new Error("userId is required");
      }
      const category: NotificationCategory = input.category ?? "media";
      if (input.category && !NOTIFICATION_CATEGORIES.includes(input.category)) {
        throw new Error(`category must be one of ${NOTIFICATION_CATEGORIES.join(", ")}`);
      }
      const connectionId = await ensureInboxConnection(input.userId);
      await ensureSubscription(connectionId, category);
      void NOTIFICATION_SEVERITIES;

      await emit({
        type: "media.request.available",
        category,
        severity: "info",
        audience: { kind: "user", userId: input.userId },
        payload: {
          requestId: `demo-${Date.now()}`,
          mediaId: "demo",
          title: input.title ?? "Demo notification",
        },
      });
      return { recipientUserId: input.userId, connectionId };
    },
  });
}
