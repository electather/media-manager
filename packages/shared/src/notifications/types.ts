import type { Permission } from "../auth";
import type { NotificationCategory, NotificationSeverity, NotificationEventType } from "./enums";

export interface BaseEvent {
  id: string; // ULID, set by emit() if absent
  occurredAt: string; // ISO-8601, set by emit() if absent
  source?: string; // plugin id or server module that emitted
}

export type NotificationAudience =
  | { kind: "user"; userId: string }
  | { kind: "admin"; permission: Permission };

export interface NotificationEventEnvelope<
  T extends NotificationEventType,
  P = unknown,
> extends BaseEvent {
  type: T;
  category: NotificationCategory;
  severity: NotificationSeverity;
  audience: NotificationAudience;
  correlationKey?: string; // indexed; reserved for future coalescing
  payload: P;
}

export interface NotificationAction {
  label: string;
  url: string;
  style?: "default" | "primary" | "danger";
}

export interface NotificationMessage {
  // Core — every plugin must render this. Always populated by the template.
  title: string;
  body: string;
  severity: NotificationSeverity;
  category: NotificationCategory;
  actionUrl?: string;

  // Rich — optional. Plugins ignore what they don't support.
  bodyMarkdown?: string;
  image?: { url: string; alt?: string };
  thumbnail?: { url: string; alt?: string };
  actions?: NotificationAction[];

  structured?: Record<string, string | number | boolean>;
}
