import { z } from "zod";
import { ALL_PERMISSIONS } from "../auth";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_SEVERITIES,
  NOTIFICATION_DELIVERY_STATUSES,
  NOTIFICATION_CONTENT_KINDS,
} from "./enums";

export const notificationCategorySchema = z.enum(NOTIFICATION_CATEGORIES);
export const notificationSeveritySchema = z.enum(NOTIFICATION_SEVERITIES);
export const notificationDeliveryStatusSchema = z.enum(NOTIFICATION_DELIVERY_STATUSES);
export const notificationContentKindSchema = z.enum(NOTIFICATION_CONTENT_KINDS);

export const notificationActionSchema = z.object({
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
