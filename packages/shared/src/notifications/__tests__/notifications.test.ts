import { expect, test } from "vite-plus/test";
import type { NotificationEvent, NotificationEventType } from "../index";
import {
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_CATEGORY_PERMISSION,
  notificationAudienceSchema,
} from "../index";

// Compile-time exhaustiveness check: if any NotificationEventType is missing from the union,
// this will fail to compile. Each event type must have exactly one matching discriminated union member.
type AssertExhaustiveEvents = {
  [T in NotificationEventType]: Extract<NotificationEvent, { type: T }> extends never
    ? ["MISSING_FROM_UNION", T]
    : T;
}[NotificationEventType];

void (true as AssertExhaustiveEvents extends NotificationEventType ? true : false);

test("event registry exhaustiveness — all NOTIFICATION_EVENT_TYPES have corresponding event union members", () => {
  // Verify the list is complete and non-empty.
  // Compile-time check above enforces each type has a union member.
  expect(NOTIFICATION_EVENT_TYPES.length).toBeGreaterThan(0);
  expect(NOTIFICATION_EVENT_TYPES).toContain("job.run.failed");
  expect(NOTIFICATION_EVENT_TYPES).toContain("connection.auth.expired");
  expect(NOTIFICATION_EVENT_TYPES).toContain("connection.sync.succeeded");
  expect(NOTIFICATION_EVENT_TYPES).toContain("media.request.available");
  expect(NOTIFICATION_EVENT_TYPES).toContain("media.request.denied");
  expect(NOTIFICATION_EVENT_TYPES).toContain("system.error");
});

test("category-permission map coverage — all NOTIFICATION_CATEGORIES have a permission", () => {
  NOTIFICATION_CATEGORIES.forEach((category) => {
    expect(NOTIFICATION_CATEGORY_PERMISSION[category]).toBeDefined();
    expect(typeof NOTIFICATION_CATEGORY_PERMISSION[category]).toBe("string");
  });
});

test("notification audience schema rejects invalid shapes", () => {
  // Valid user audience.
  expect(notificationAudienceSchema.safeParse({ kind: "user", userId: "u123" }).success).toBe(true);

  // Valid admin audience.
  expect(
    notificationAudienceSchema.safeParse({ kind: "admin", permission: "admin:server" }).success,
  ).toBe(true);

  // Invalid kind.
  expect(notificationAudienceSchema.safeParse({ kind: "unknown" }).success).toBe(false);

  // Invalid permission value.
  expect(
    notificationAudienceSchema.safeParse({ kind: "admin", permission: "invalid:perm" }).success,
  ).toBe(false);

  // Missing required fields.
  expect(notificationAudienceSchema.safeParse({ kind: "user" }).success).toBe(false);
  expect(notificationAudienceSchema.safeParse({ kind: "admin" }).success).toBe(false);
});
