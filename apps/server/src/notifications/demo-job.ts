import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationCategory,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationSeverity,
} from "@ent-mcp/shared/notifications";
import { getDb } from "../db/client";
import { notificationSubscriptions, serviceConnections } from "../db/schema";
import { registerTriggerable } from "../jobs/triggerable";
import { encryptJson } from "../crypto/helpers";
import { emit } from "./emit";

interface DemoInput {
  userId: string;
  eventType?: NotificationEventType;
}

const EVENT_TYPE_LABELS: Record<NotificationEventType, string> = {
  "media.request.available": "Media available",
  "media.request.denied": "Media denied",
  "connection.auth.expired": "Connection auth expired",
  "connection.sync.succeeded": "Connection sync succeeded",
  "job.run.failed": "Job run failed",
  "system.error": "System error",
};

const EVENT_TYPE_META: Record<
  NotificationEventType,
  { category: NotificationCategory; severity: NotificationSeverity }
> = {
  "media.request.available": { category: "media", severity: "info" },
  "media.request.denied": { category: "media", severity: "warn" },
  "connection.auth.expired": { category: "auth", severity: "warn" },
  "connection.sync.succeeded": { category: "sync", severity: "info" },
  "job.run.failed": { category: "system", severity: "error" },
  "system.error": { category: "system", severity: "error" },
};

const inputJsonSchema = {
  type: "object",
  properties: {
    userId: {
      type: "string",
      description: "Recipient user",
      "x-picker": "user",
    },
    eventType: {
      type: "string",
      enum: [...NOTIFICATION_EVENT_TYPES],
      "x-enum-labels": EVENT_TYPE_LABELS,
      description: "Notification event type (defaults to media.request.available)",
    },
  },
  required: ["userId"],
} as const;

function buildEvent(
  eventType: NotificationEventType,
  userId: string,
): Omit<NotificationEvent, "id" | "occurredAt"> {
  const meta = EVENT_TYPE_META[eventType];
  const audience = { kind: "user" as const, userId };
  switch (eventType) {
    case "media.request.available":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: {
          requestId: `demo-${Date.now()}`,
          mediaId: "demo",
          title: "Demo media",
        },
      };
    case "media.request.denied":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: {
          requestId: `demo-${Date.now()}`,
          mediaId: "demo",
          title: "Demo media",
          reason: "demo denial",
        },
      };
    case "connection.auth.expired":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { connectionId: "demo-connection", pluginId: "demo-plugin" },
      };
    case "connection.sync.succeeded":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { connectionId: "demo-connection", pluginId: "demo-plugin", itemCount: 42 },
      };
    case "job.run.failed":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { jobId: "demo.job", runId: "demo-run", error: "demo error" },
      };
    case "system.error":
      return {
        type: eventType,
        category: meta.category,
        severity: meta.severity,
        audience,
        payload: { errorSource: "demo", message: "Demo notification triggered by admin" },
      };
  }
}

async function ensureInboxConnection(userId: string): Promise<string> {
  const db = getDb();
  // The schema permits multiple service_connections rows per (user, plugin),
  // so we wrap the read+insert in a transaction to serialize concurrent
  // triggers and order by createdAt to return a stable canonical id.
  return db.transaction(async (tx) => {
    const existing = await tx
      .select({ id: serviceConnections.id })
      .from(serviceConnections)
      .where(and(eq(serviceConnections.userId, userId), eq(serviceConnections.pluginId, "inbox")))
      .orderBy(asc(serviceConnections.createdAt), asc(serviceConnections.id))
      .get();
    if (existing) return existing.id;
    const id = randomUUID();
    const now = Date.now();
    const credEnc = await encryptJson({ kind: "inbox" });
    await tx.insert(serviceConnections).values({
      id,
      userId,
      pluginId: "inbox",
      status: "connected",
      enabled: 1,
      isDefault: 0,
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
  });
}

async function ensureSubscription(connectionId: string, category: NotificationCategory) {
  const db = getDb();
  // Use onConflictDoNothing so that running the demo job does not silently
  // re-enable a category the user has explicitly disabled.
  await db
    .insert(notificationSubscriptions)
    .values({ connectionId, category, enabled: 1 })
    .onConflictDoNothing({
      target: [notificationSubscriptions.connectionId, notificationSubscriptions.category],
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
      const eventType: NotificationEventType = input.eventType ?? "media.request.available";
      if (input.eventType && !NOTIFICATION_EVENT_TYPES.includes(input.eventType)) {
        throw new Error(`eventType must be one of ${NOTIFICATION_EVENT_TYPES.join(", ")}`);
      }
      const { category } = EVENT_TYPE_META[eventType];
      const connectionId = await ensureInboxConnection(input.userId);
      await ensureSubscription(connectionId, category);

      await emit(buildEvent(eventType, input.userId));
      return { recipientUserId: input.userId, connectionId };
    },
  });
}
