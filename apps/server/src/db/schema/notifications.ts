// @owner: notifications
import { sqliteTable, text, integer, index, primaryKey } from "drizzle-orm/sqlite-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_SEVERITIES,
} from "@ent-mcp/shared/notifications";
import { user } from "./auth";
import { serviceConnections } from "./credentials";

export const notificationSubscriptions = sqliteTable(
  "notification_subscriptions",
  {
    connectionId: text("connection_id")
      .notNull()
      .references(() => serviceConnections.id, { onDelete: "cascade" }),
    category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
    enabled: integer("enabled").notNull().default(1),
  },
  (table) => [primaryKey({ columns: [table.connectionId, table.category] })],
);

export const notificationDeliveries = sqliteTable(
  "notification_deliveries",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id").notNull(),
    eventType: text("event_type", { enum: NOTIFICATION_EVENT_TYPES }).notNull(),
    eventPayload: text("event_payload").notNull(),
    recipientConnectionId: text("recipient_connection_id").references(() => serviceConnections.id, {
      onDelete: "set null",
    }),
    recipientUserId: text("recipient_user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    status: text("status", { enum: NOTIFICATION_DELIVERY_STATUSES }).notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    lastError: text("last_error"),
    lastErrorCode: text("last_error_code"),
    providerMessageId: text("provider_message_id"),
    correlationKey: text("correlation_key"),
    // Earliest wall-clock millisecond at which the next delivery attempt may
    // run. NULL means "eligible immediately" (initial pending row); the sweep
    // and any direct trigger short-circuit when set in the future.
    nextAttemptAt: integer("next_attempt_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("notification_deliveries_user_created_idx").on(table.recipientUserId, table.createdAt),
    index("notification_deliveries_status_updated_idx").on(table.status, table.updatedAt),
    index("notification_deliveries_correlation_key_idx").on(table.correlationKey),
    index("notification_deliveries_next_attempt_idx").on(table.nextAttemptAt),
  ],
);

export const notificationsInbox = sqliteTable(
  "notifications_inbox",
  {
    id: text("id").primaryKey(),
    deliveryId: text("delivery_id").references(() => notificationDeliveries.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull(),
    severity: text("severity", { enum: NOTIFICATION_SEVERITIES }).notNull(),
    category: text("category", { enum: NOTIFICATION_CATEGORIES }).notNull(),
    actionUrl: text("action_url"),
    imageUrl: text("image_url"),
    imageAlt: text("image_alt"),
    readAt: integer("read_at"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    index("notifications_inbox_user_created_idx").on(table.userId, table.createdAt),
    index("notifications_inbox_user_read_created_idx").on(
      table.userId,
      table.readAt,
      table.createdAt,
    ),
  ],
);

export const insertNotificationSubscriptionSchema = createInsertSchema(notificationSubscriptions);
export const selectNotificationSubscriptionSchema = createSelectSchema(notificationSubscriptions);

export const insertNotificationDeliverySchema = createInsertSchema(notificationDeliveries);
export const selectNotificationDeliverySchema = createSelectSchema(notificationDeliveries);

export const insertNotificationInboxSchema = createInsertSchema(notificationsInbox);
export const selectNotificationInboxSchema = createSelectSchema(notificationsInbox);
