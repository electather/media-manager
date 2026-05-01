import {
  AlertCircleIcon,
  AlertTriangleIcon,
  FilmIcon,
  InfoIcon,
  RefreshCwIcon,
  ServerIcon,
  ShieldIcon,
  type LucideIcon,
} from "lucide-react";
import type {
  InboxItemDto,
  NotificationCategory,
  NotificationSeverity,
  NotificationAction,
} from "@ent-mcp/shared/notifications";
import { m } from "@/paraglide/messages";

// Client-side DTO extending InboxItemDto with fields the API will expose in a
// future update. All additions are optional; components render the richer
// variant when present and fall back to `body` otherwise.
export interface NotificationItemDto extends InboxItemDto {
  bodyMarkdown?: string;
  /** "admin" when the notification targets an admin-permission audience. */
  audienceKind?: "user" | "admin";
  actions?: NotificationAction[];
}

export type Density = "comfortable" | "compact";
export type Intensity = "subtle" | "loud";

export interface CategoryMeta {
  Icon: LucideIcon;
}

export function categoryLabel(category: NotificationCategory): string {
  switch (category) {
    case "media":
      return m.notifications_category_media();
    case "sync":
      return m.notifications_category_sync();
    case "auth":
      return m.notifications_category_auth();
    case "system":
      return m.notifications_category_system();
  }
}

export interface SeverityMeta {
  Icon: LucideIcon;
  /** Tailwind class for icon container background. */
  iconBg: string;
  /** Tailwind class for icon foreground color. */
  iconColor: string;
  /** Tailwind class for loud left-border accent (border-l-2). */
  loudBorder: string;
  /** Tailwind class for loud background tint. */
  loudBg: string;
}

export const CATEGORY_META = {
  media: { Icon: FilmIcon },
  sync: { Icon: RefreshCwIcon },
  auth: { Icon: ShieldIcon },
  system: { Icon: ServerIcon },
} satisfies Record<NotificationCategory, CategoryMeta>;

export const SEVERITY_META = {
  info: {
    Icon: InfoIcon,
    iconBg: "bg-primary/10",
    iconColor: "text-primary",
    loudBorder: "border-l-primary",
    loudBg: "bg-primary/10",
  },
  warn: {
    Icon: AlertTriangleIcon,
    iconBg: "bg-primary/15",
    iconColor: "text-primary",
    loudBorder: "border-l-primary",
    loudBg: "bg-primary/15",
  },
  error: {
    Icon: AlertCircleIcon,
    iconBg: "bg-destructive/10",
    iconColor: "text-destructive",
    loudBorder: "border-l-destructive",
    loudBg: "bg-destructive/10",
  },
} satisfies Record<NotificationSeverity, SeverityMeta>;
