import {
  NOTIFICATION_EVENT_TYPES,
  type NotificationCategory,
  type NotificationEvent,
  type NotificationEventType,
  type NotificationSeverity,
} from "@ent-mcp/shared/notifications";
import { registerTriggerable } from "../../jobs/triggerable";
import { ensureInboxConnection } from "../../plugin-runtime";
import * as repo from "../repo";
import { getNotificationsService } from "../service";

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

// fallow-ignore-next-line complexity
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
        payload: { requestId: `demo-${Date.now()}`, mediaId: "demo", title: "Demo media" },
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

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isValidEventType(value: unknown): value is NotificationEventType {
  return (
    typeof value === "string" && (NOTIFICATION_EVENT_TYPES as readonly string[]).includes(value)
  );
}

function requireUserId(input: DemoInput | null | undefined): string {
  const userId = input?.userId;
  if (!isNonEmptyString(userId)) throw new Error("userId is required");
  return userId;
}

function resolveEventType(input: DemoInput | null | undefined): NotificationEventType {
  const requested = input?.eventType;
  if (requested === undefined) return "media.request.available";
  if (!isValidEventType(requested)) {
    throw new Error(`eventType must be one of ${NOTIFICATION_EVENT_TYPES.join(", ")}`);
  }
  return requested;
}

/**
 * Validates `DemoInput` and returns the resolved (userId, eventType) pair.
 * Kept thin (delegates branching to `requireUserId` + `resolveEventType`) so
 * each function's CRAP score stays under `health.maxCrap` — the original
 * inline check exceeded the budget.
 */
function resolveDemoInput(input: DemoInput | null | undefined): {
  userId: string;
  eventType: NotificationEventType;
} {
  return { userId: requireUserId(input), eventType: resolveEventType(input) };
}

export function registerDemo(): void {
  registerTriggerable<DemoInput, { recipientUserId: string; connectionId: string }>({
    id: "host.notifications.demo",
    name: "Send demo notification",
    description: "Emits a demo notification to the chosen user. Useful for verifying delivery.",
    requiredPermission: "admin:jobs",
    inputSchema: inputJsonSchema as unknown as Record<string, unknown>,
    handler: async (_ctx, input) => {
      const { userId, eventType } = resolveDemoInput(input);
      const { category } = EVENT_TYPE_META[eventType];
      const connectionId = await ensureInboxConnection(userId);
      await repo.ensureSubscription(connectionId, category);

      await getNotificationsService().publishNotification(buildEvent(eventType, userId));
      return { recipientUserId: userId, connectionId };
    },
  });
}
