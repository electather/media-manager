import { z } from "zod";
import { ALL_PERMISSIONS } from "../auth";
import { AUTH_KINDS } from "../plugins/enums";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_CONTENT_KINDS,
  NOTIFICATION_EVENT_TYPES,
} from "./enums";

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export const notificationDeliveryStatusSchema = z.enum(NOTIFICATION_DELIVERY_STATUSES);
export const notificationContentKindSchema = z.enum(NOTIFICATION_CONTENT_KINDS);

const notificationActionSchema = z.object({
  label: z.string(),
  url: z.string().url(),
  style: z.enum(["default", "primary", "danger"]).optional(),
});

export const notificationMessageSchema = z.object({
  title: z.string(),
  body: z.string(),
  severity: notificationSeveritySchema,
  category: notificationCategorySchema,
  actionUrl: z.string().url().optional(),
  bodyMarkdown: z.string().optional(),
  image: z.object({ url: z.string().url(), alt: z.string().optional() }).optional(),
  thumbnail: z.object({ url: z.string().url(), alt: z.string().optional() }).optional(),
  actions: z.array(notificationActionSchema).optional(),
  structured: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
});

export const notificationAudienceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("user"), userId: z.string() }),
  z.object({ kind: z.literal("admin"), permission: z.enum(ALL_PERMISSIONS) }),
]);

export const notificationEventTypeSchema = z.enum(NOTIFICATION_EVENT_TYPES);

export const notificationEventSchema = z.object({
  id: z.string(),
  occurredAt: z.string(),
  type: notificationEventTypeSchema,
  category: notificationCategorySchema,
  severity: notificationSeveritySchema,
  audience: notificationAudienceSchema,
  correlationKey: z.string().optional(),
  source: z.string().optional(),
  payload: z.record(z.string(), z.unknown()),
});

// ─── HTTP request/response schemas ──────────────────────────────────────────

const idsBodySchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(500) });

const paginatedLimitField = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? 50 : typeof v === "string" ? Number(v) : v))
  .pipe(z.number().int().min(1).max(200));

export const inboxMarkBodySchema = idsBodySchema;
export const inboxDeleteBodySchema = idsBodySchema;

export const inboxMarkAllReadBodySchema = z
  .object({ category: notificationCategorySchema.optional() })
  .strict();

export const inboxDeleteAllBodySchema = z
  .object({
    readOnly: z.boolean().optional(),
    olderThan: z.string().datetime().optional(),
  })
  .strict();

export const inboxListQuerySchema = z
  .object({
    unreadOnly: z
      .union([z.boolean(), z.literal("true"), z.literal("false")])
      .optional()
      .transform((v) => (typeof v === "string" ? v === "true" : v)),
    category: notificationCategorySchema.optional(),
    severity: notificationSeveritySchema.optional(),
    cursor: z.string().optional(),
    limit: paginatedLimitField,
  })
  .strict();

export const subscriptionUpdateBodySchema = z.object({ enabled: z.boolean() });

// Upper-bound applied to the wire shape to bound parser memory; the route
// returns 413 for `length > SUBSCRIPTION_BULK_LIMIT` (200) per the design
// doc, so this ceiling sits above the application limit.
const SUBSCRIPTIONS_BULK_HARD_CEILING = 1000;

export const subscriptionsBulkBodySchema = z.object({
  updates: z
    .array(
      z.object({
        connectionId: z.string().min(1),
        category: notificationCategorySchema,
        enabled: z.boolean(),
      }),
    )
    .min(1)
    .max(SUBSCRIPTIONS_BULK_HARD_CEILING),
});

// Coerces query-string numbers (Hono parses query params as strings) and
// rejects anything that does not produce a finite number. Without this guard
// `?from=foo` would resolve to `NaN`, get passed unchanged to drizzle's
// `gte`, and return whatever SQLite happens to compare NaN against.
const optionalEpochMs = z
  .union([z.number(), z.string()])
  .optional()
  .transform((v) => (v === undefined ? undefined : typeof v === "string" ? Number(v) : v))
  .pipe(z.number().finite().optional());

export const adminDeliveriesQuerySchema = z
  .object({
    status: notificationDeliveryStatusSchema.optional(),
    category: notificationCategorySchema.optional(),
    severity: notificationSeveritySchema.optional(),
    recipientUserId: z.string().min(1).optional(),
    from: optionalEpochMs,
    to: optionalEpochMs,
    cursor: z.string().optional(),
    limit: paginatedLimitField,
  })
  .strict();

export const adminSettingsBodySchema = z
  .object({
    inboxRetentionDays: z.number().int().min(1).max(3650).optional(),
    deliveryRetentionDays: z.number().int().min(1).max(3650).optional(),
  })
  .strict();

export const adminSettingsResponseSchema = z.object({
  inboxRetentionDays: z.number().int(),
  deliveryRetentionDays: z.number().int(),
});

export const inboxItemSchema = z.object({
  id: z.string(),
  createdAt: z.number(),
  readAt: z.number().nullable(),
  title: z.string(),
  body: z.string(),
  severity: notificationSeveritySchema,
  category: notificationCategorySchema,
  actionUrl: z.string().nullable(),
  image: z.object({ url: z.string(), alt: z.string().optional() }).nullable(),
});

export const inboxListResponseSchema = z.object({
  items: z.array(inboxItemSchema),
  nextCursor: z.string().optional(),
  unreadCount: z.number().int().nonnegative(),
});

export const categoryEntrySchema = z.object({
  id: notificationCategorySchema,
  label: z.string(),
  description: z.string(),
  requiredPermission: z.enum(ALL_PERMISSIONS),
  allowed: z.boolean(),
});

/**
 * Notification picker entries are full plugin summaries (the same shape served
 * by `/api/connections/available`) plus the per-channel `supportsKinds` list.
 * Returning the summary shape lets the Notifications settings page hand the
 * entry straight to `ConnectionModal` without a second `/connections/available`
 * round-trip.
 */
export const pluginEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  logoUrl: z.string().optional(),
  authKind: z.enum(AUTH_KINDS),
  poolable: z.boolean(),
  userScopedCapabilities: z.array(z.object({ id: z.string(), version: z.string() })),
  globalScopedCapabilities: z.array(z.object({ id: z.string(), version: z.string() })),
  userConfigSchema: z.record(z.string(), z.unknown()).nullable(),
  credentialsSchema: z.record(z.string(), z.unknown()).nullable(),
  adminSharedAvailable: z.boolean(),
  supportsKinds: z.array(notificationContentKindSchema),
});

export const subscriptionRowSchema = z.object({
  connectionId: z.string(),
  category: notificationCategorySchema,
  enabled: z.boolean(),
});

export const adminDeliveryRowSchema = z.object({
  id: z.string(),
  eventId: z.string(),
  eventType: notificationEventTypeSchema,
  status: notificationDeliveryStatusSchema,
  recipientConnectionId: z.string().nullable(),
  recipientUserId: z.string(),
  attemptCount: z.number().int(),
  lastError: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  providerMessageId: z.string().nullable(),
  correlationKey: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

export type InboxListQuery = z.infer<typeof inboxListQuerySchema>;
export type AdminDeliveriesQuery = z.infer<typeof adminDeliveriesQuerySchema>;
export type AdminSettingsBody = z.infer<typeof adminSettingsBodySchema>;
export type AdminSettingsResponse = z.infer<typeof adminSettingsResponseSchema>;
export type InboxItemDto = z.infer<typeof inboxItemSchema>;
export type CategoryEntry = z.infer<typeof categoryEntrySchema>;
export type PluginEntry = z.infer<typeof pluginEntrySchema>;
export type SubscriptionRow = z.infer<typeof subscriptionRowSchema>;
export type AdminDeliveryRow = z.infer<typeof adminDeliveryRowSchema>;
